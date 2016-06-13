'use strict';

const storage_stat_schema = {
    type: 'object',
    properties: {
        total: {
            // total amount of storage space on the node/drive
            type: 'number',
        },
        free: {
            // amount of available storage on the node/drive
            type: 'number',
        },
        used: {
            // amount of storage used by the system
            // computed from the data blocks owned by this node
            type: 'number',
        },
        alloc: {
            // preallocated storage space
            type: 'number',
        },
        limit: {
            // top limit for used storage
            type: 'number',
        }
    }
};

module.exports = {
    id: 'node_schema',
    type: 'object',
    required: [
        '_id',
        'name',
    ],
    properties: {
        _id: {
            format: 'objectid'
        },
        deleted: {
            format: 'idate'
        },
        name: {
            type: 'string'
        },
        system: {
            format: 'objectid'
        },
        pool: {
            format: 'objectid'
        },
        peer_id: {
            // the identifier used for p2p signaling
            format: 'objectid'
        },
        ip: {
            // the public ip of the node
            type: 'string',
        },
        base_address: {
            // the server address that the node is using
            type: 'string',
        },
        rpc_address: {
            // listening rpc address (url) of the agent
            type: 'string',
        },
        heartbeat: {
            // the last time the agent sent heartbeat
            format: 'idate',
        },
        version: {
            // the last agent version acknoledged
            type: 'string',
        },

        // migrating_to_pool: {
        //     type: 'boolean'
        // },
        // decommissioning: {
        //     type: 'boolean',
        // },
        // decommissioned: {
        //     type: 'boolean',
        // },
        // disabled: {
        //     type: 'boolean',
        // },

        // node storage stats - sum of drives
        storage: storage_stat_schema,

        drives: {
            type: 'array',
            items: {
                type: 'object',
                required: ['mount', 'drive_id'],
                properties: {
                    mount: {
                        // mount point - linux, drive letter - windows
                        type: 'string',
                    },
                    drive_id: {
                        // a fixed identifier (uuid / device-id / or something like that)
                        type: 'string',
                    },
                    // drive storage stats
                    storage: storage_stat_schema
                }
            }
        },

        // OS information sent by the agent
        os_info: {
            type: 'object',
            properties: {
                hostname: {
                    type: 'string'
                },
                ostype: {
                    type: 'string'
                },
                platform: {
                    type: 'string'
                },
                arch: {
                    type: 'string'
                },
                release: {
                    type: 'string'
                },
                uptime: {
                    format: 'idate'
                },
                loadavg: {
                    type: 'array',
                    items: {
                        type: 'number'
                    }
                },
                totalmem: {
                    type: 'number'
                },
                freemem: {
                    type: 'number'
                },
                cpus: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {},
                        additionalProperties: true
                    }
                },
                networkInterfaces: {
                    type: 'object',
                    properties: {},
                    additionalProperties: true
                }
            }
        },

        latency_to_server: {
            type: 'array',
            items: {
                type: 'number'
            }
        },
        latency_of_disk_read: {
            type: 'array',
            items: {
                type: 'number'
            }
        },
        latency_of_disk_write: {
            type: 'array',
            items: {
                type: 'number'
            }
        },

        is_cloud_node: {
            type: 'boolean',
        },

        error_since_hb: {
            format: 'idate'
        },

        debug_level: {
            type: 'integer',
        },
    }
};
