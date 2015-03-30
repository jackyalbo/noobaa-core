/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var os = require('os');
var util = require('util');
var path = require('path');
var http = require('http');
var assert = require('assert');
var crypto = require('crypto');
var mkdirp = require('mkdirp');
var express = require('express');
var express_morgan_logger = require('morgan');
var express_body_parser = require('body-parser');
var express_method_override = require('method-override');
var express_compress = require('compression');
var api = require('../api');
var rpc_http = require('../rpc/rpc_http');
var rpc_ice = require('../rpc/rpc_ice');
var dbg = require('noobaa-util/debug_module')(__filename);
var LRUCache = require('../util/lru_cache');
var size_utils = require('../util/size_utils');
var ifconfig = require('../util/ifconfig');
var AgentStore = require('./agent_store');
var config = require('../../config.js');
var diskspace = require('../util/diskspace_util');

module.exports = Agent;


/**
 *
 * AGENT
 *
 * the glorious noobaa agent.
 *
 */
function Agent(params) {
    var self = this;

    assert(params.address, 'missing param: address');
    self.client = new api.Client({
        address: params.address
    });

    assert(params.node_name, 'missing param: node_name');
    self.node_name = params.node_name;
    self.token = params.token;
    self.prefered_port = params.prefered_port;
    self.storage_path = params.storage_path;
    self.use_http_server = params.use_http_server;

    if (self.storage_path) {
        assert(!self.token, 'unexpected param: token. ' +
            'with storage_path the token is expected in the file <storage_path>/token');

        self.store = new AgentStore(self.storage_path);
        self.store_cache = new LRUCache({
            name: 'AgentBlocksCache',
            max_length: 10,
            load: self.store.read_block.bind(self.store)
        });
    } else {
        assert(self.token, 'missing param: token. ' +
            'without storage_path the token must be provided as agent param');

        this.store = new AgentStore.MemoryStore();
        self.store_cache = new LRUCache({
            name: 'AgentBlocksCache',
            max_length: 1,
            load: self.store.read_block.bind(self.store)
        });
    }

    var agent_server = {
        write_block: self.write_block.bind(self),
        read_block: self.read_block.bind(self),
        replicate_block: self.replicate_block.bind(self),
        delete_blocks: self.delete_blocks.bind(self),
        check_block: self.check_block.bind(self),
        kill_agent: self.kill_agent.bind(self),
        self_test_io: self.self_test_io.bind(self),
        self_test_peer: self.self_test_peer.bind(self),
    };

    var app = express();
    app.use(express_morgan_logger('dev'));
    app.use(express_body_parser.json());
    app.use(express_body_parser.raw({
        // increase size limit on raw requests to allow serving data blocks
        limit: 4 * size_utils.MEGABYTE
    }));
    app.use(express_body_parser.text());
    app.use(express_body_parser.urlencoded({
        extended: false
    }));
    app.use(express_method_override());
    app.use(express_compress());
    app.use(rpc_http.BASE_PATH, rpc_http.middleware(api.rpc));

    var http_server = http.createServer(app);
    http_server.on('listening', self._server_listening_handler.bind(self));
    http_server.on('close', self._server_close_handler.bind(self));
    http_server.on('error', self._server_error_handler.bind(self));

    self.agent_app = app;
    self.agent_server = agent_server;
    self.http_server = http_server;
    self.http_port = 0;

    // TODO these sample geolocations are just for testing
    self.geolocation = _.sample([
        'United States', 'Canada', 'Brazil', 'Mexico',
        'China', 'Japan', 'Korea', 'India', 'Australia',
        'Israel', 'Romania', 'Russia',
        'Germany', 'England', 'France', 'Spain'
    ]);

}


/**
 *
 * START
 *
 */
Agent.prototype.start = function() {
    var self = this;

    self.is_started = true;

    return Q.fcall(function() {
            return self._init_node();
        })
        .then(function() {
            return self._start_stop_http_server();
        })
        .then(function() {

            // register agent_server in rpc, with domain as peer_id
            // to match only calls to me
            api.rpc.register_service(self.agent_server, 'agent_api', self.peer_id, {
                authorize: function(req, method_api) {
                    // TODO verify aithorized tokens in agent?
                }
            });

            if (config.use_ice_when_possible || config.use_ws_when_possible) {
                dbg.log0('start ws agent id: ' + self.node_id + ' peer id: ' + self.peer_id);
                self.ws_socket = rpc_ice.serve(api.rpc, self.peer_id);
            }
        })
        .then(function() {
            return self.send_heartbeat();
        })
        .then(null, function(err) {
            console.error('AGENT server failed to start', err);
            self.stop();
            throw err;
        });
};


/**
 *
 * STOP
 *
 */
Agent.prototype.stop = function() {
    var self = this;
    dbg.log0('stop agent ' + self.node_id);
    self.is_started = false;
    self._start_stop_http_server();
    self._start_stop_heartbeats();
};



/**
 *
 * _init_node
 *
 */
Agent.prototype._init_node = function() {
    var self = this;

    return Q.fcall(function() {

            // if not using storage_path, a token should be provided
            if (!self.storage_path) return self.token;

            // load the token file
            var token_path = path.join(self.storage_path, 'token');
            return Q.nfcall(fs.readFile, token_path);
        })
        .then(function(token) {
            // use the token as authorization and read the auth info
            self.client.options.auth_token = token;
            return self.client.auth.read_auth();
        })
        .then(function(res) {
            dbg.log0('res:',res);
            // if we are already authorized with our specific node_id, use it
            if (res.account && res.system &&
                res.extra && res.extra.node_id) {
                self.node_id = res.extra.node_id;
                self.peer_id = res.extra.peer_id;
                dbg.log0('authorized node ' + self.node_name +
                    ' id ' + self.node_id + ' peer_id ' + self.peer_id);
                return;
            }

            // if we have authorization to create a node, do it
            if (res.account && res.system &&
                _.contains(['admin', 'create_node'], res.role) &&
                res.extra && res.extra.tier) {
                dbg.log0('create node', self.node_name, 'tier', res.extra.tier);
                return self.client.node.create_node({
                    name: self.node_name,
                    tier: res.extra.tier,
                    geolocation: self.geolocation,
                    storage_alloc: 100 * size_utils.GIGABYTE
                }).then(function(node) {
                    self.node_id = node.id;
                    self.peer_id = node.peer_id;
                    self.client.options.auth_token = node.token;
                    dbg.log0('created node', self.node_name, 'id', node.id, 'peer_id', self.peer_id);
                    if (self.storage_path) {
                        dbg.log0('save node token', self.node_name, 'id', node.id);
                        var token_path = path.join(self.storage_path, 'token');
                        return Q.nfcall(fs.writeFile, token_path, node.token);
                    }
                });
            }

            console.error('bad token', res);
            throw new Error('bad token');
        });
};



// HTTP SERVER ////////////////////////////////////////////////////////////////


/**
 *
 * _start_stop_http_server
 *
 */
Agent.prototype._start_stop_http_server = function() {
    var self = this;
    if (self.is_started) {
        // using port to determine if the server is already listening
        if (!self.http_port && self.use_http_server) {
            return Q.Promise(function(resolve, reject) {
                self.http_server.once('listening', resolve);
                self.http_server.listen(self.prefered_port);
            });
        }
    } else {
        if (self.http_port) {
            self.http_server.close();
        }
    }
};


/**
 *
 * _server_listening_handler
 *
 */
Agent.prototype._server_listening_handler = function() {
    this.http_port = this.http_server.address().port;
    dbg.log0('AGENT server listening on port ' + this.http_port);
};


/**
 *
 * _server_close_handler
 *
 */
Agent.prototype._server_close_handler = function() {
    dbg.log0('AGENT server closed');
    this.http_port = 0;
    // set timer to check the state and react by restarting or not
    setTimeout(this._start_stop_http_server.bind(this), 1000);
};


/**
 *
 * _server_error_handler
 *
 */
Agent.prototype._server_error_handler = function(err) {
    // the server will also trigger close event after
    console.error('AGENT server error', err);
};




// HEARTBEATS /////////////////////////////////////////////////////////////////



/**
 *
 * send_heartbeat
 *
 */
Agent.prototype.send_heartbeat = function() {
    var self = this;
    var store_stats;
    var device_info_send_time;
    var now_time;
    var drive = '/';
    var totalSpace;
    var freeSpace;
    var hourlyHB = false;

    // chk if windows
    if (os.type().match(/win/i) && !os.type().match(/darwin/i)) {
        drive ='c';
    }

    dbg.log0('send heartbeat by agent', self.node_id);

    return Q.when(self.store.get_stats())
        .then(function(store_stats_arg) {
            store_stats = store_stats_arg;
            now_time = Date.now();

            if (!self.device_info_send_time ||
                now_time > self.device_info_send_time + 3600000) {
                hourlyHB = true;
                return Q.nfcall(diskspace.check, drive);
            } else {
                return [];
            }
        })
        .spread(function(total, free, status) {
            if (hourlyHB) {
                if (status && status.trim() === 'READY') {
                    freeSpace = free;
                    totalSpace = total;
                } else {
                    dbg.log0('AGENT problem getting FS space, status: ', status);
                }
            }
        }, function(err) {
            dbg.log0('AGENT error getting FS space, result: ', err);
        })
        .then(function() {

            var alloc = store_stats.alloc;
            if (hourlyHB && freeSpace && !isNaN(freeSpace)) {
                alloc = Math.min(alloc, freeSpace);
            }

            var ip = ifconfig.get_main_external_ipv4();
            var params = {
                id: self.node_id,
                geolocation: self.geolocation,
                ip: ip,
                port: self.http_port || 0,
                storage: {
                    alloc: alloc,
                    used: store_stats.used
                }
            };

            if (hourlyHB) {
                device_info_send_time = now_time;
                params.device_info = {
                    hostname: os.hostname(),
                    type: os.type(),
                    platform: os.platform(),
                    arch: os.arch(),
                    release: os.release(),
                    uptime: os.uptime(),
                    loadavg: os.loadavg(),
                    totalmem: os.totalmem(),
                    freemem: os.freemem(),
                    cpus: os.cpus(),
                    networkInterfaces: os.networkInterfaces()
                };

                if (totalSpace && freeSpace) {
                    params.device_info.totalstorage = totalSpace;
                    params.device_info.freestorage = freeSpace;
                }
            }

            dbg.log3('AGENT HB params: ',params);

            return self.client.node.heartbeat(params);
        })
        .then(function(res) {
            if (device_info_send_time) {
                self.device_info_send_time = device_info_send_time;
            }

            if (res.storage) {
                // report only if used storage mismatch
                // TODO compare with some accepted error and handle
                if (store_stats.used !== res.storage.used) {
                    dbg.log0('AGENT used storage not in sync ',
                        store_stats.used, ' expected ', res.storage.used);
                }

                // update the store when allocated size change
                if (store_stats.alloc !== res.storage.alloc) {
                    dbg.log0('AGENT update alloc storage from ',
                        store_stats.alloc, ' to ', res.storage.alloc);
                    self.store.set_alloc(res.storage.alloc);
                }
            }

            if (res.version && self.heartbeat_version && self.heartbeat_version !== res.version) {
                dbg.log0('AGENT version changed, exiting');
                process.exit();
            }
            self.heartbeat_version = res.version;
            self.heartbeat_delay_ms = res.delay_ms;

        }, function(err) {

            dbg.log0('HEARTBEAT FAILED', err, err.stack);

            // schedule delay to retry on error
            self.heartbeat_delay_ms = 30000 * (1 + Math.random());

        })['finally'](function() {
            self._start_stop_heartbeats();
        });
};


/**
 *
 * _start_stop_heartbeats
 *
 */
Agent.prototype._start_stop_heartbeats = function() {
    var self = this;

    // first clear the timer
    clearTimeout(self.heartbeat_timeout);
    self.heartbeat_timeout = null;

    // set the timer when started
    if (self.is_started) {
        var ms = self.heartbeat_delay_ms;
        ms = ms || (60000 * (1 + Math.random())); // default 1 minute
        ms = Math.max(ms, 1000); // force above 1 second
        ms = Math.min(ms, 300000); // force below 5 minutes
        self.heartbeat_timeout = setTimeout(self.send_heartbeat.bind(self), ms);
    }
};



// AGENT API //////////////////////////////////////////////////////////////////



Agent.prototype.read_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    dbg.log0('AGENT read_block', block_id);
    return self.store_cache.get(block_id)
        .then(null, function(err) {
            if (err === 'TAMPERING DETECTED') {
                err = req.rest_error(500, 'TAMPERING DETECTED');
            }
            throw err;
        });
};

Agent.prototype.write_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var data = req.rest_params.data;
    dbg.log0('AGENT write_block', block_id, data.length);
    self.store_cache.invalidate(block_id);
    return self.store.write_block(block_id, data);
};

Agent.prototype.replicate_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    var source = req.rest_params.source;
    dbg.log0('AGENT replicate_block', block_id);
    self.store_cache.invalidate(block_id);

    // read from source agent
    return self.client.agent.read_block({
            block_id: source.id
        }, {
            address: source.host,
            domain: source.peer,
            peer: source.peer,
            ws_socket: self.ws_socket,
        })
        .then(function(data) {
            return self.store.write_block(block_id, data);
        });
};

Agent.prototype.delete_blocks = function(req) {
    var self = this;
    var blocks = req.rest_params.blocks;
    dbg.log0('AGENT delete_blocks', blocks);
    self.store_cache.multi_invalidate(blocks);
    return self.store.delete_blocks(blocks);
};

Agent.prototype.check_block = function(req) {
    var self = this;
    var block_id = req.rest_params.block_id;
    dbg.log0('AGENT check_block', block_id);
    var slices = req.rest_params.slices;
    return self.store_cache.get(block_id)
        .then(function(data) {
            // calculate the md5 of the requested slices
            var md5_hash = crypto.createHash('md5');
            _.each(slices, function(slice) {
                var buf = data.slice(slice.start, slice.end);
                md5_hash.update(buf);
            });
            var md5_sum = md5_hash.digest('hex');
            return {
                checksum: md5_sum
            };
        });
};

Agent.prototype.kill_agent = function(req) {
    dbg.log0('AGENT kill requested, exiting');
    process.exit();
};

Agent.prototype.self_test_io = function(req) {
    dbg.log0('SELF TEST IO got ' + req.rest_params.data.length + ' reply ' + req.rest_params.response_length);
    return new Buffer(req.rest_params.response_length);
};

Agent.prototype.self_test_peer = function(req) {
    var self = this;
    var target = req.rest_params.target;
    dbg.log0('SELF TEST PEER req ' + req.rest_params.request_length +
        ' res ' + req.rest_params.response_length +
        ' target ' + util.inspect(target));

    // read from target agent
    return self.client.agent.self_test_io({
            data: new Buffer(req.rest_params.request_length),
            response_length: req.rest_params.response_length,
        }, {
            address: target.host,
            domain: target.peer,
            peer: target.peer,
            ws_socket: self.ws_socket,
        })
        .then(function(data) {
            if (((!data || !data.length) && req.rest_params.response_length > 0) ||
                (data && data.length && data.length !== req.rest_params.response_length)) {
                throw new Error('SELF TEST PEER response_length mismatch');
            }
        });
};
