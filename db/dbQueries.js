const { isRiderId, isSegmentId, isFastify, isEmpty } = require("../utility/general");
const { getStravaSegmentById, convertGearIdToOCD } = require('../db/stravaRideData');
const {
    convertToImperial,
    convertSegmentToImperial,
    convertSegmentEffortToImperial,
    convertSegmentToUpdateCount,
    allValuesDefined,
} = require('../utility/strava');

const getFirstSegmentEffortDate = async (fastify, riderId, segmentId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if( !isSegmentId(riderId)){
        throw new TypeError("Invalid parameter: segmentId must be an integer");
    }

    let query = `Select min(start_date) as earliestdate from segmentsstravaefforts where riderid = $1 and id = $2;`;
    const params = [riderId, segmentId];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);

        if (rows.length === 0) {
            return null;
        }

        return rows[0].earliestdate || null;
    } catch (err) {
        throw new Error(`Database error fetching getFirstSegmentEffortDate with riderId ${riderId} segmentId ${segmentId}: ${error.message}`);//th
    }
}

const upsertRides = async (fastify, riderId, rides, defaultBikeId) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    let ridesAdded = 0;
    for (const ride of rides) {
      const existingRide = await fastify.pg.query('SELECT 1 FROM rides WHERE riderid = $1 AND stravaid = $2', [riderId, ride.id]);
      if (existingRide.rowCount === 0) {
        ride.gear_id = await convertGearIdToOCD(fastify, riderId, ride.gear_id, defaultBikeId);
        const rideImperial = convertToImperial(ride);

        try{
            await fastify.pg.query(`
                INSERT INTO rides (
                    date,
                    distance,
                    speedavg,
                    speedmax,
                    cadence,
                    hravg,
                    hrmax,
                    title,
                    poweravg,
                    powermax,
                    bikeid,
                    stravaid,
                    comment,
                    elevationgain,
                    elapsedtime,
                    powernormalized,
                    trainer,
                    riderid
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
              `,  [
                    rideImperial.start_date_local,
                    rideImperial.distance,
                    rideImperial.average_speed,
                    rideImperial.max_speed,
                    rideImperial.average_cadence,
                    rideImperial.average_heartrate,
                    rideImperial.max_heartrate,
                    rideImperial.name,
                    rideImperial.average_watts,
                    rideImperial.max_watts,
                    rideImperial.gear_id,
                    rideImperial.id,
                    '',
                    rideImperial.total_elevation_gain,
                    rideImperial.moving_time,
                    rideImperial.weighted_average_watts,
                    rideImperial.type === 'VirtualRide' ? 1 : 0,
                    riderId
                  ]
              );
              ridesAdded++;
        }
        catch(err){
            console.error('Database error in refreshStravaToken:', err);
            return null;
        }
      }
    }
    return ridesAdded;
}

const upsertStarredSegment = async (fastify, riderId, segment) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (isEmpty(segment) || 'id' in segment === false) {
        throw new TypeError("Invalid parameter: segment object with id must exist");
    }

    try{
        const existingStarredSegment = await fastify.pg.query('SELECT 1 FROM segmentsstrava WHERE riderid = $1 AND id = $2', [riderId, segment.id]);
        if (existingStarredSegment.rowCount === 0) {
            const segmentImperial = convertSegmentToImperial(segment);

            await fastify.pg.query(`
                INSERT INTO segmentsstrava (
                    riderid,
                    id,
                    name,
                    distance,
                    average_grade,
                    maximum_grade,
                    elevation_high,
                    elevation_low,
                    start_latitude,
                    start_longitude,
                    end_latitude,
                    end_longitude,
                    climb_category
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                `,  [
                    riderId,
                    segmentImperial.id,
                    segmentImperial.name,
                    segmentImperial.distance,
                    segmentImperial.average_grade,
                    segmentImperial.maximum_grade,
                    segmentImperial.elevation_high,
                    segmentImperial.elevation_low,
                    segmentImperial.start_latitude,
                    segmentImperial.start_longitude,
                    segmentImperial.end_latitude,
                    segmentImperial.end_longitude,
                    segmentImperial.climb_category
                    ]
            );
        }
    }
    catch(error){
        console.error('Database error in upsertStarredSegment inserting new segmentsstrava:', error);
        throw new TypeError(`Database error in upsertStarredSegment inserting new segmentsstrava: ${error}`);
    }
}

const upsertStarredSegmentEffort = async(fastify, riderId, segmentEffort) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (isEmpty(segmentEffort) || 'id' in segmentEffort === false) { return false; }

    try{
        const existingSegmentEffort = await fastify.pg.query('SELECT 1 FROM segmentsstravaefforts WHERE riderid = $1 AND id = $2 AND stravaid = $3', [riderId, segmentEffort.segment.id, segmentEffort.activity.id]);
        if (existingSegmentEffort.rowCount === 0) {
            const segmentEffortImperial = convertSegmentEffortToImperial(segmentEffort);
            await fastify.pg.query(`
                INSERT INTO segmentsstravaefforts (
                    riderid,
                    id,
                    stravaid,
                    elapsed_time,
                    moving_time,
                    start_date,
                    distance,
                    start_index,
                    end_index,
                    average_cadence,
                    average_watts,
                    average_heartrate,
                    max_heartrate
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                `,  [
                    riderId,
                    segmentEffortImperial.id,
                    segmentEffortImperial.stravaid,
                    segmentEffortImperial.elapsed_time,
                    segmentEffortImperial.moving_time,
                    segmentEffortImperial.start_date,
                    segmentEffortImperial.distance,
                    segmentEffortImperial.start_index,
                    segmentEffortImperial.end_index,
                    segmentEffortImperial.average_cadence,
                    segmentEffortImperial.average_watts,
                    segmentEffortImperial.average_heartrate,
                    segmentEffortImperial.max_heartrate
                    ]
            );
        }
    }
    catch(error){
        console.error('Database error in upsertStarredSegmentEffort inserting new segmentsstrava:', error);
        throw new TypeError(`Database error in upsertStarredSegmentEffort inserting new segment effor: ${error}`);
    }
}

const updateSegmentStats = async (fastify, riderId, segment ) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if( isEmpty(segment)){
        throw new TypeError("Invalid parameter: segment object must exist");
    }

    const segmentCountUpdate = convertSegmentToUpdateCount(segment);
    if(allValuesDefined(segmentCountUpdate,'updateSegmentStats:segmentCountUpdate' )){
        try{
            await fastify.pg.query(`
                UPDATE segmentsstrava
                SET
                    total_elevation_gain = $1,
                    total_effort_count = $2,
                    athlete_count = $3,
                    effort_count = $4
                WHERE
                    riderid = $5
                    AND id = $6
                `,  [
                        segmentCountUpdate.total_elevation_gain,
                        segmentCountUpdate.total_effort_count,
                        segmentCountUpdate.athlete_count,
                        segmentCountUpdate.effort_count,
                        riderId,
                        segmentCountUpdate.id
                    ]
                );
        }
        catch(error){
            console.error('Database error in updateSegmentStats:', error);
            throw new TypeError(`Database error in updateSegmentStats: ${error}`);
        }
    }
}

const processRideSegments = async (fastify, riderId, stravaRideDetail, tokens) => {
    if( isEmpty(stravaRideDetail)) return false;

    if('segment_efforts' in stravaRideDetail){
        for (const key in stravaRideDetail.segment_efforts) {
            if (stravaRideDetail.segment_efforts.hasOwnProperty(key)) {
                const segmentEffort = stravaRideDetail.segment_efforts[key];
                if( segmentEffort?.segment?.starred){
                    // Make sure that the starred segment exists in OCD Cyclist db.
                    await upsertStarredSegment(fastify, riderId, segmentEffort.segment);

                        // Now insert the segment effort
                    await upsertStarredSegmentEffort(fastify, riderId, segmentEffort);

                    // Now refresh the segments count statistics
                    const segmentResponse = await getStravaSegmentById(tokens.accesstoken, segmentEffort.segment.id);
                    await updateSegmentStats(fastify, riderId, segmentResponse);
                }
            }
        }
    }
}

const updateStarredSegments = async (fastify, riderId, starredSegments, tokens) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if( isEmpty(starredSegments) || !Array.isArray(starredSegments) || starredSegments.length === 0) return false;

    for( let i = 0; i < starredSegments.length; i++ ){
        try{
            const segment = starredSegments[i];
            const segmentImperial = convertSegmentToImperial(segment);

            await fastify.pg.query(`
                INSERT INTO segmentsstrava (
                    riderid,
                    id,
                    name,
                    distance,
                    average_grade,
                    maximum_grade,
                    elevation_high,
                    elevation_low,
                    start_latitude,
                    start_longitude,
                    end_latitude,
                    end_longitude,
                    climb_category,
                    starred_date,
                    pr_time,
                    pr_date
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (riderid, id)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    distance = EXCLUDED.distance,
                    average_grade = EXCLUDED.average_grade,
                    maximum_grade = EXCLUDED.maximum_grade,
                    elevation_high = EXCLUDED.elevation_high,
                    elevation_low = EXCLUDED.elevation_low,
                    start_latitude = EXCLUDED.start_latitude,
                    start_longitude = EXCLUDED.start_longitude,
                    end_latitude = EXCLUDED.end_latitude,
                    end_longitude = EXCLUDED.end_longitude,
                    climb_category = EXCLUDED.climb_category,
                    starred_date = EXCLUDED.starred_date,
                    pr_time = EXCLUDED.pr_time,
                    pr_date = EXCLUDED.pr_date;

                    `,  [
                    riderId,
                    segmentImperial.id,
                    segmentImperial.name,
                    segmentImperial.distance,
                    segmentImperial.average_grade,
                    segmentImperial.maximum_grade,
                    segmentImperial.elevation_high,
                    segmentImperial.elevation_low,
                    segmentImperial.start_latitude,
                    segmentImperial.start_longitude,
                    segmentImperial.end_latitude,
                    segmentImperial.end_longitude,
                    segmentImperial.climb_category,
                    segmentImperial.starred_date,
                    segmentImperial.pr_time,
                    segmentImperial.pr_date
                    ]
            );

            // Now refresh the segments count statistics
            const segmentResponse = await getStravaSegmentById(tokens.accesstoken, segment.id);
            await updateSegmentStats(fastify, riderId, segmentResponse);
        }
        catch(err){
            console.error('Database error in updateStarredSegments inserting new segmentsstrava:', err);
        }
    }
}

const processSegmentEfforts = async (fastify, riderId, segmentEfforts) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if( isEmpty(segmentEfforts) || !Array.isArray(segmentEfforts) || segmentEfforts.length === 0) return;

    for( let i = 0; i < segmentEfforts.length; i++){
        await upsertStarredSegmentEffort(fastify, riderId, segmentEfforts[i]);
    }
}

module.exports = {
    getFirstSegmentEffortDate,
    upsertRides,
    upsertStarredSegment,
    upsertStarredSegmentEffort,
    updateSegmentStats,
    processRideSegments,
    updateStarredSegments,
    processSegmentEfforts
};