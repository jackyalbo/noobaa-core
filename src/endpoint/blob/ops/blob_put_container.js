/* Copyright (C) 2016 NooBaa */
'use strict';

function put_container(req, res) {
    return req.object_sdk.create_bucket({ name: req.params.bucket })
        .then(() => {
            res.statusCode = 201;
        });
}

module.exports = {
    handler: put_container,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
