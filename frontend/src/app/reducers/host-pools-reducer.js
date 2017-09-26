/* Copyright (C) 2016 NooBaa */

import { keyBy, keyByProperty, flatMap, groupBy } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(state, { payload }) {
    const { pools, buckets, tiers } = payload;
    const nodePools = pools.filter(pool => pool.resource_type === 'HOSTS');
    const bucketMapping = _mapPoolsToBuckets(buckets, tiers);
    return keyByProperty(nodePools, 'name', pool => _mapPool(pool, bucketMapping));
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapPoolsToBuckets(buckets, tiers) {
    const bucketsByTierName = keyBy(
        buckets,
        bucket => bucket.tiering.tiers[0].tier,
        bucket => bucket.name
    );

    const pairs = flatMap(
        tiers,
        tier => tier.attached_pools.map(pool => ({
            bucket: bucketsByTierName[tier.name],
            pool
        }))
    );

    return groupBy(
        pairs,
        pair => pair.pool,
        pair => pair.bucket
    );
}

function _mapPool(pool, bucketMapping) {
    const activityList = (pool.data_activities.activities || [])
        .map(activity => ({
            type: activity.reason,
            nodeCount: activity.count,
            progress: activity.progress,
            eta: activity.time.end
        }));

    return {
        name: pool.name,
        mode: pool.mode,
        storage: pool.storage,
        associatedAccounts: pool.associated_accounts,
        connectedBuckets: bucketMapping[pool.name] || [],
        hostCount: pool.hosts.count,
        hostsByMode: pool.hosts.by_mode,
        undeletable: pool.undeletable,
        activities: {
            hostCount: pool.data_activities.host_count,
            list: activityList
        }
    };
}
// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});