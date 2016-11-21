/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const stream = require('stream');
const crypto = require('crypto');
const ip_module = require('ip');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const RpcError = require('../../rpc/rpc_error');
const url_utils = require('../../util/url_utils');
const server_rpc = require('../server_rpc');
const func_store = require('./func_store');
const func_stats_store = require('./func_stats_store');
const system_store = require('../system_services/system_store').get_instance();
const node_allocator = require('../node_services/node_allocator');

const FUNC_CONFIG_FIELDS_MUTABLE = [
    'description',
    'role',
    'handler',
    'runtime',
    'memory_size',
    'timeout',
];
const FUNC_CONFIG_DEFAULTS = {
    handler: 'index',
    runtime: 'nodejs6',
    memory_size: 128,
    timeout: 60,
};
const FUNC_CONFIG_FIELDS_IMMUTABLE = [
    'code_size',
    'code_sha256',
    'last_modified',
    'resource_name',
];

function create_func(req) {
    const func_config = req.params.config;
    const func_code = req.params.code;
    const code_sha256 = crypto.createHash('sha256');
    const func = _.defaults(
        _.pick(func_config, FUNC_CONFIG_FIELDS_MUTABLE),
        FUNC_CONFIG_DEFAULTS);
    func.system = req.system._id;
    func.name = func_config.name;
    func.version = '$LATEST';
    func.last_modified = new Date();
    func.code_size = 0;
    func.resource_name = `arn:noobaa:lambda:region:${func.system}:function:${func.name}:${func.version}`;
    if (req.params.config.pools) {
        func.pools = _.map(req.params.config.pools, pool_name =>
            req.system.pools_by_name[pool_name]._id);
    } else {
        func.pools = [req.system.pools_by_name.default_pool._id];
    }
    if (!func.pools.length) {
        throw new Error('No pools');
    }

    return P.resolve()
        .then(() => {
            if (func_code.zipfile) {
                return new stream.Readable({
                    read(size) {
                        this.push(func_code.zipfile);
                        this.push(null);
                    }
                });
            } else if (func_code.s3_key) {
                // TODO func_code.s3_key
            }
            throw new Error('Unsupported code');
        })
        .then(code_stream => func_store.instance().create_code_gridfs({
            system: func.system,
            name: func.name,
            version: func.version,
            code_stream: code_stream.pipe(new stream.Transform({
                transform(buf, encoding, callback) {
                    func.code_size += buf.length;
                    code_sha256.update(buf);
                    callback(null, buf);
                }
            }))
        }))
        .then(gridfs_id => {
            func.code_sha256 = code_sha256.digest('base64');
            func.code_gridfs_id = gridfs_id;
        })
        .then(() => func_store.instance().create_func(func))
        .then(() => _load_func(req))
        .then(() => _get_func_info(req.func));
}

function update_func(req) {
    const func_config = req.params.config;
    const config_updates = _.pick(func_config, FUNC_CONFIG_FIELDS_MUTABLE);
    if (func_config.pools) {
        config_updates.pools = _.map(func_config.pools, pool_name =>
            req.system.pools_by_name[pool_name]._id);
    }
    if (req.params.code) {
        // TODO update_func: missing handling for code update
        throw new RpcError('TODO', 'Update function code is not yet implemented');
    }
    return _load_func(req)
        .then(() => func_store.instance().update_func(
            req.func._id,
            config_updates
        ))
        .then(() => _load_func(req))
        .then(() => _get_func_info(req.func));
}

function delete_func(req) {
    return _load_func(req)
        .then(() => func_store.instance().delete_code_gridfs(req.func.code_gridfs_id))
        .then(() => func_store.instance().delete_func(req.func._id));
}

function read_func(req) {
    return _load_func(req)
        .then(() => _get_func_info(req.func))
        .then(reply => {
            if (!req.params.read_code) return reply;
            return func_store.instance().read_code_gridfs(req.func.code_gridfs_id)
                .then(buffer => {
                    reply.code = {
                        zipfile: buffer
                    };
                    return reply;
                });
        })
        .then(reply => {
            if (!req.params.read_stats) return reply;
            const MINUTE = 60 * 1000;
            const HOUR = 60 * MINUTE;
            const DAY = 24 * HOUR;
            const now = Date.now();
            const last_10_minutes = now - (10 * MINUTE);
            const last_hour = now - HOUR;
            const last_day = now - DAY;
            return func_stats_store.instance().sample_func_stats({
                    system: req.func.system,
                    func: req.func._id,
                    since_time: new Date(last_day),
                    sample_size: 1000,
                })
                .then(stats => {
                    const stats_sorted_by_took =
                        _.chain(stats)
                        .reject('error')
                        .sortBy('took')
                        .value();
                    reply.stats = {
                        response_time_last_10_minutes: _calc_percentiles(
                            _.filter(stats_sorted_by_took,
                                s => s.time >= last_10_minutes),
                            'took'),
                        response_time_last_hour: _calc_percentiles(
                            _.filter(stats_sorted_by_took,
                                s => s.time >= last_hour),
                            'took'),
                        response_time_last_day: _calc_percentiles(
                            stats_sorted_by_took, 'took'),
                        requests_over_time: _.chain(stats)
                            .groupBy(s => Math.ceil(s.time.getTime() / MINUTE))
                            .map((g, t) => ({
                                time: t * MINUTE,
                                requests: g.length,
                                errors: _.filter(g, 'error').length
                            }))
                            .value()
                    };
                    return reply;
                });
        });
}

function _calc_percentiles(list, prop) {
    const percentiles = list.length ?
        _.map([
            0, 10, 20, 30, 40,
            50, 60, 70, 80, 90,
            95, 99, 99.9, 100
        ], i => ({
            percent: i,
            value: list[Math.min(
                list.length - 1,
                Math.floor(list.length * i * 0.01)
            )][prop]
        })) : [];
    return {
        count: list.length,
        percentiles: percentiles,
    };

}

function list_funcs(req) {
    return P.resolve()
        .then(() => func_store.instance().list_funcs(req.system._id))
        .then(funcs => ({
            functions: _.map(funcs, _get_func_info)
        }));
}

function list_func_versions(req) {
    return P.resolve()
        .then(() => func_store.instance().list_func_versions(
            req.system._id,
            req.params.name
        ))
        .then(funcs => ({
            versions: _.map(funcs, _get_func_info)
        }));
}

function invoke_func(req) {
    const time = new Date();
    return _load_func(req)
        .then(() => P.map(req.func.pools,
            pool => node_allocator.refresh_pool_alloc(pool)))
        .then(() => {
            const func = req.func;
            const node = node_allocator.allocate_node(func.pools);
            if (!node) throw new Error('invoke_func: no nodes for allocation');
            dbg.log1('invoke_func allocate_node', node.name, node.pool);
            return server_rpc.client.func_node.invoke_func({
                name: func.name,
                version: func.version,
                code_size: func.code_size,
                code_sha256: func.code_sha256,
                event: req.params.event,
                aws_config: _make_aws_config(req),
            }, {
                address: node.rpc_address
            });
        })
        .then(res => func_stats_store.instance().create_func_stat({
                system: req.func.system,
                func: req.func._id,
                time: time,
                took: Date.now() - time.getTime(),
                error: res.error ? true : undefined,
            })
            .return(res)
        );
}

function _load_func(req) {
    const system = req.system._id;
    const name = req.params.name || _.get(req, 'params.config.name');
    const version = req.params.version || _.get(req, 'params.config.version');
    return P.resolve()
        .then(() => func_store.instance().read_func(system, name, version))
        .then(func => {
            req.func = func;
            func.pools = _.map(func.pools, pool_id => system_store.data.get_by_id(pool_id));
            return func;
        });
}

function _get_func_info(func) {
    const config = _.pick(func,
        'name',
        'version',
        FUNC_CONFIG_FIELDS_MUTABLE,
        FUNC_CONFIG_FIELDS_IMMUTABLE);
    config.last_modified = func.last_modified.getTime();
    config.pools = _.map(func.pools, pool => {
        if (pool.name) return pool.name;
        return system_store.data.get_by_id(pool).name;
    });
    const code_location = {
        url: '',
        repository: ''
    };
    return {
        config,
        code_location
    };
}

function _make_aws_config(req) {
    // TODO copied from base_address calc from system_server, better define once
    const s3_host =
        req.system.base_address ?
        url_utils.quick_parse(req.system.base_address).hostname :
        ip_module.address();
    const s3_port = parseInt(process.env.S3_PORT, 10) || 80;
    const account_keys = req.account.access_keys[0];
    return {
        region: 'us-east-1',
        endpoint: `http://${s3_host}:${s3_port}`,
        sslEnabled: false,
        accessKeyId: account_keys.access_key,
        secretAccessKey: account_keys.secret_key,
    };
}


exports.create_func = create_func;
exports.update_func = update_func;
exports.delete_func = delete_func;
exports.read_func = read_func;
exports.list_funcs = list_funcs;
exports.list_func_versions = list_func_versions;
exports.invoke_func = invoke_func;
