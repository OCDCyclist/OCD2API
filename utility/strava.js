const unitConverstion = {
    METERS_TO_MILES: 0.000621371,
    METERS_TO_FEET: 3.28084,
    MPS_TO_MPH: 2.23694
};

const removeTrailingZ = (inputString) => {
    if( typeof(inputString) !== 'string' ) return '';
    if (inputString.endsWith("Z")) {
        return inputString.slice(0, -1);
    }
    return inputString;
}

const convertToImperial = (activity) => {
    return{
        start_date_local: removeTrailingZ(activity.start_date_local),
        distance: (activity.distance * unitConverstion.METERS_TO_MILES).toFixed(1),
        average_speed: (activity.average_speed * unitConverstion.MPS_TO_MPH).toFixed(1),
        max_speed: (activity.max_speed * unitConverstion.MPS_TO_MPH).toFixed(2),
        average_cadence: (activity.average_cadence || 0).toFixed(0),
        average_heartrate: (activity.average_heartrate || 0 ).toFixed(0),
        max_heartrate: (activity.max_heartrate || 0).toFixed(0),
        name: activity.name,
        average_watts: (activity.average_watts || 0).toFixed(0),
        max_watts: (activity.max_watts || 0).toFixed(0),
        gear_id: activity.gear_id,
        id: activity.id,
        total_elevation_gain: (activity.total_elevation_gain * unitConverstion.METERS_TO_FEET).toFixed(0),
        moving_time: activity.moving_time,
        weighted_average_watts: activity.weighted_average_watts,
        type: activity.type
    }
}

const convertSegmentToImperial = (segment) => {
    return{
        id: segment.id,
        name: segment.name,
        distance: (segment.distance * unitConverstion.METERS_TO_MILES).toFixed(1),
        average_grade: segment.average_grade,
        maximum_grade: segment.maximum_grade,
        elevation_high: (segment.elevation_high * unitConverstion.METERS_TO_FEET).toFixed(0),
        elevation_low: (segment.elevation_low * unitConverstion.METERS_TO_FEET).toFixed(0),
        start_latitude: segment.start_latlng[0],
        start_longitude: segment.start_latlng[1],
        end_latitude: segment.end_latlng[0],
        end_longitude: segment.end_latlng[0],
        climb_category: segment.climb_category,
        starred_date:  removeTrailingZ(segment?.starred_date || null),
        pr_time: segment.pr_time || 0,
        pr_date: removeTrailingZ(segment?.athlete_pr_effort?.start_date_local || removeTrailingZ(segment?.starred_date || null))
    }
}

const convertSegmentEffortToImperial = (segmentEffort) => {
    return{
        id: segmentEffort.segment.id,
        stravaid: segmentEffort.activity.id,
        elapsed_time: segmentEffort.elapsed_time,
        moving_time: segmentEffort.moving_time,
        start_date: removeTrailingZ(segmentEffort.start_date_local),
        distance: (segmentEffort.distance * unitConverstion.METERS_TO_MILES).toFixed(1),
        start_index: segmentEffort.start_index,
        end_index: segmentEffort.end_index,
        average_cadence: (segmentEffort.average_cadence || 0).toFixed(0),
        average_watts: (segmentEffort.average_watts || 0).toFixed(0),
        average_heartrate: (segmentEffort.average_heartrate || 0).toFixed(0),
        max_heartrate:  (segmentEffort.max_heartrate || 0).toFixed(0)
    }
}

const convertSegmentToUpdateCount = (segmentToCountUpdate) => {
    return{
        id: segmentToCountUpdate.id,
        total_elevation_gain: (segmentToCountUpdate.total_elevation_gain * unitConverstion.METERS_TO_FEET).toFixed(0),
        total_effort_count: segmentToCountUpdate.effort_count,
        athlete_count: segmentToCountUpdate.athlete_count,
        effort_count: segmentToCountUpdate?.athlete_segment_stats?.effort_count || 0
    }
}

const allValuesDefined = (obj, location) =>{
    const returnValue = Object.values(obj).every(value => value !== undefined && value !== null);
    if( !returnValue){
        console.error(`Database values for ${location} are not valid: ${JSON.stringify(obj)}`);
    }
    return returnValue;
}

module.exports = {
    allValuesDefined,
    convertSegmentToUpdateCount,
    convertSegmentEffortToImperial,
    convertSegmentToImperial,
    convertToImperial,
    allValuesDefined,
    removeTrailingZ,
    unitConverstion
};
