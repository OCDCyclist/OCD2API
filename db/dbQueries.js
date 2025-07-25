const xss = require("xss");
const dayjs = require('dayjs');
const zlib = require("zlib");
const { isRiderId, isIntegerValue, isSegmentId, isFastify, isEmpty, isValidDate, isValidNumber, POWER_CURVE_INTERVALS } = require("../utility/general");
const { getStravaSegmentById, convertGearIdToOCD } = require('../db/stravaRideData');
const {
    convertToImperial,
    convertSegmentToImperial,
    convertSegmentEffortToImperial,
    convertSegmentToUpdateCount,
    allValuesDefined,
} = require('../utility/strava');
const { getSortedPropertyNames, writeActivityFile, getFilenameFromPath } = require('../utility/fileUtilities');
const { isInteger, forEach } = require("mathjs");
const { nSecondAverageMax, RollingAverageType } = require("../utility/metrics");
const { convertCelsiusToFahrenheit, convertMetersPerSecondToMilesPerHour, convertMetersToFeet, convertMetersToMiles } = require("../utility/conversion");
const {roundValue} = require('../utility/numerical');
const { decompressIntBuffer, decompressFloatBuffer } = require('../utility/compression');
const { formatDateTimeYYYYMMDDHHmmss } = require('../utility/dates');
const { calculateRideBoundingBox } = require('../processing/calculateRideBoundingBox');
const { calculateRideFractalDimension } = require('../processing/calculateRideFractalDimension');

const getFirstSegmentEffortDate = async (fastify, riderId, segmentId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if( !isSegmentId(segmentId)){
        throw new TypeError("Invalid parameter: segmentId must be an integer");
    }

    let query = `Select min(start_date) as earliestdate from segmentsstravaefforts where riderid = $1 and segmentid = $2;`;
    const params = [riderId, segmentId];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);

        if (rows.length === 0) {
            return null;
        }

        return rows[0].earliestdate || null;
    } catch (error) {
        throw new Error(`Database error fetching getFirstSegmentEffortDate with riderId ${riderId} segmentId ${segmentId}: ${error.message}`);//th
    }
}

const getStarredSegments = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `SELECT * FROM get_segmentsstrava_data_withtags($1)`;
    const params = [riderId];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getStarredSegments for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getStarredSegments with riderId ${riderId}: ${error.message}`);//th
    }
}

const upsertRides = async (fastify, riderId, rides, defaultBikeId) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    const ridesAdded = [];
    for (const ride of rides) {
      const existingRide = await fastify.pg.query('SELECT 1 FROM rides WHERE riderid = $1 AND stravaid = $2', [riderId, ride.id]);
      if (existingRide.rowCount === 0) {
        ride.gear_id = await convertGearIdToOCD(fastify, riderId, ride.gear_id, defaultBikeId);
        const rideImperial = convertToImperial(ride);

        try{
            const result = await fastify.pg.query(`
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
                RETURNING rideid
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
              if(result && result.rows && result.rows.length > 0){
                const newRideId = result.rows[0].rideid;
                rideImperial.rideid = newRideId;
                ridesAdded.push(rideImperial);
              }
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
        const existingSegmentEffort = await fastify.pg.query('SELECT 1 FROM segmentsstravaefforts WHERE riderid = $1 AND segmentid = $2 AND effortid = $3', [riderId, segmentEffort.segment.id, segmentEffort.id]);
        if (existingSegmentEffort.rowCount === 0) {
            const segmentEffortImperial = convertSegmentEffortToImperial(segmentEffort);
            await fastify.pg.query(`
                INSERT INTO segmentsstravaefforts (
                    riderid,
                    segmentid,
                    effortid,
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
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                `,  [
                    riderId,
                    segmentEffortImperial.segmentid,
                    segmentEffortImperial.effortid,
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

const processRideStreams = async (fastify, riderId, rideid, stravaId, data) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    if(data){
        const filename = await writeActivityFile(riderId, rideid, stravaId, data);
        const streams = getSortedPropertyNames(data);
        try{
            await fastify.pg.query(`
                INSERT INTO rides_streams (
                    rideid,
                    stravaid,
                    filename,
                    streams
                )
                VALUES ($1, $2, $3, $4)
                `,  [
                    rideid,
                    stravaId,
                    getFilenameFromPath(filename),
                    streams
                    ]
            );
        }
        catch(error){
            console.error('Database error in processRideStreams inserting new ride stream information:', error);
            throw new TypeError(`Database error in processRideStreams inserting new ride stream information: ${error}`);
        }
    }
    else{
        try{
            await fastify.pg.query(`
                INSERT INTO rides_streams (
                    rideid,
                    stravaid,
                    filename,
                    streams
                )
                VALUES ($1, $2, $3, $4)
                `,  [
                    rideid,
                    stravaId,
                    'unable to obtain streams',
                    ''
                    ]
            );
        }
        catch(error){
            console.error('Database error in processRideStreams inserting new ride stream information:', error);
            throw new TypeError(`Database error in processRideStreams inserting new ride stream information: ${error}`);
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
        catch(error){
            console.error('Database error in updateStarredSegments inserting new segmentsstrava:', error);
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

const upsertWeight = async (fastify, riderId, date, weight, bodyfatfraction, bodyh2ofraction) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if(!isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be valid");
    }

    if(!isValidDate(date)){
        throw new TypeError("Invalid parameter: date must be valid");
    }

    if(!isValidNumber(weight)){
        throw new TypeError("Invalid parameter: weight must be valid");
    }

    if(!isValidNumber(bodyfatfraction)){
        throw new TypeError("Invalid parameter: bodyfatfraction must be valid");
    }

    if(!isValidNumber(bodyh2ofraction)){
        throw new TypeError("Invalid parameter: bodyh2ofraction must be valid");
    }

    try{
        const result = await fastify.pg.query(`
            INSERT INTO riderweight (riderId, date, weight, bodyfatfraction, bodyh2ofraction) VALUES (
                $1, $2, $3, $4, $5
            )
            ON CONFLICT (riderid, date)
            DO UPDATE SET
                weight = EXCLUDED.weight,
                bodyfatfraction = EXCLUDED.bodyfatfraction,
                bodyh2ofraction = EXCLUDED.bodyh2ofraction,
                updatedttm = CURRENT_TIMESTAMP
            RETURNING riderid, date, weight, bodyfatfraction, bodyh2ofraction;
            `,  [
                riderId,
                date,
                weight,
                bodyfatfraction,
                bodyh2ofraction
            ]
        );
        return result;
    }
    catch(error){
        console.error(`Database error in upsertWeight inserting / updating new weight for riderid ${riderid}:`, error.message);
    }
}

const getWeightTrackerData = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        Select
            date,
            weight,
            weight7,
            weight30,
            weight365,
            bodyfatfraction,
            bodyfatfraction7,
            bodyfatfraction30,
            bodyfatfraction365,
            bodyh2ofraction,
            bodyh2ofraction7,
            bodyh2ofraction30,
            bodyh2ofraction365
        from
            riderweight
        WHERE riderid = $1
        order by date desc
        limit 1;
    `;
    const params = [riderId];

    try {
        // This will automatically release the one-time-use connection.
        const result = await fastify.pg.query(query, params);

        return result;

    } catch (err) {
        throw new Error(`Database error fetching getWeightTrackerData with riderId ${riderId}: ${error.message}`);//th
    }
}

const getWeightPeriodData = async (fastify, riderId, period) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }
    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let periodToUse = typeof(period) === 'string' ? period.toLowerCase().trim() : 'month';

    let query = `
        SELECT
            date,
            weight,
            weight7,
            weight30,
            weight365,
            bodyfatfraction,
            bodyfatfraction7,
            bodyfatfraction30,
            bodyfatfraction365,
            bodyh2ofraction,
            bodyh2ofraction7,
            bodyh2ofraction30,
            bodyh2ofraction365
        FROM
            get_riderweight_by_daterange($1,$2);
    `;
    const params = [riderId, periodToUse];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getWeightPeriodData for riderId ${riderId} period: ${periodToUse}`);//th
    } catch (err) {
        throw new Error(`Database error fetching getWeightPeriodData with riderId ${riderId}: ${error.message}`);//th
    }
}

const getCummulatives = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `SELECT * FROM get_rider_cummulatives_recent($1)`;
    const params = [riderId];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getCummulatives for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getCummulatives with riderId ${riderId}: ${error.message}`);//th
    }
}

const getCummulativesByYear = async (fastify, riderId, years) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if (!isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!Array.isArray(years)) {
        throw new TypeError("Invalid parameter: years values must be an array");
    }

    if(years.length > 0 && !years.every(Number.isInteger)){
        throw new TypeError("Invalid parameter: years values must be integers");
    }

    let query = `SELECT * FROM public.get_rider_cummulatives($1, $2)`;
    const params = [riderId, years];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getCummulativesByYear for riderId ${riderId} years: ${JSON.stringify(years)}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getCummulativesByYear with riderId ${riderId} years: ${JSON.stringify(years)}: ${error.message}`);//th
    }
}

const getYearAndMonth = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `SELECT * FROM get_rider_metrics_by_year_month($1)`;
    const params = [riderId];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getYearAndMonth for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getYearAndMonth with riderId ${riderId}: ${error.message}`);//th
    }
}

const getYearAndDOW = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `SELECT * FROM get_rider_metrics_by_year_dow($1)`;
    const params = [riderId];

    try {
        // This will automatically release the one-time-use connection.
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getYearAndDOW for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getYearAndDOW with riderId ${riderId}: ${error.message}`);//th
    }
}

const getMonthAndDOM = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `SELECT * FROM get_rider_metrics_by_month_dom($1)`;
    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getMonthAndDOM for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getMonthAndDOM with riderId ${riderId}: ${error.message}`);//th
    }
}

const getDashboard = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `SELECT * FROM summarize_rides_and_goals($1)`;
    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows) && rows.length > 0){
            return rows[0];
        }
        throw new Error(`Invalid data for getDashboard for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getDashboard with riderId ${riderId}: ${error.message}`);//th
    }
}

const getRidesLastMonth = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides30days($1);
    `;
    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRidesLastMonth for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRidesLastMonth with riderId ${riderId}: ${error.message}`);//th
    }
}

const getRidesHistory = async (fastify, riderId, years) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!Array.isArray(years) || !years.every(Number.isInteger)) {
        return reply.status(400).send({ error: 'Invalid parameter:  years must be an array of integers.' });
    }

    let query = `
    SELECT
      rideid,
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
      coalesce(bikename, 'no bike') as bikename,
      coalesce(stravaname, 'no bike') as stravaname,
      stravaid,
      comment,
      elevationgain,
      elapsedtime,
      powernormalized,
      intensityfactor,
      tss,
      matches,
      trainer,
      elevationloss,
      datenotime,
      device_name,
      fracdim,
      tags,
      calculated_weight_kg,
      cluster,
      hrzones,
      powerzones,
      cadencezones
    FROM
      get_rides_by_years($1, $2);
    `;
    const params = [riderId, years];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for get_rides_by_years for riderId ${riderId} years ${JSON.stringify(years)}`);//th

    } catch (error) {
        throw new Error(`Database error fetching get_rides_by_years with riderId ${riderId} years ${JSON.stringify(years)}: ${error.message}`);//th
    }
}

const getRidesByDate = async (fastify, riderId, date) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId];

    if (date && dayjs(date, 'YYYY-MM-DD', true).isValid()) {
        params.push(date);
    }
    else{
        throw new TypeError("Invalid parameter: date must be provided");
    }

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_by_date($1, $2)
        `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRidesByDate for riderId ${riderId} date ${date}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRidesByDate with riderId ${riderId} date ${date}: ${error.message}`);//th
    }
}

const getRidesByYearMonth = async (fastify, riderId, year, month) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(year)) {
        throw new TypeError("Invalid parameter: year must be an integer");
    }

    if ( !isIntegerValue(month) || month <=0 || month > 12) {
        throw new TypeError("Invalid parameter: month must be an integer between 1 and 12");
    }

    const params = [riderId, year, month];

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_by_year_month($1, $2, $3)
        `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Database error fetching getRidesByYearMonth with riderId ${riderId} year ${year} month ${month}: ${error.message}`);//th
    } catch (error) {
        throw new Error(`Database error fetching getRidesByYearMonth with riderId ${riderId} year ${year} month ${month}: ${error.message}`);//th
    }
}

const getRidesByYearDOW = async (fastify, riderId, year, dow) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(year)) {
        throw new TypeError("Invalid parameter: year must be an integer");
    }

    if ( !isIntegerValue(dow) || dow <0 || dow > 7) {
        throw new TypeError("Invalid parameter: month must be an integer between 0 (Sunday) and 6 (Saturday) and 7 for All");
    }

    const params = [riderId, year, dow];

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_by_year_dow($1, $2, $3)
        `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Database error fetching getRidesByYearDOW with riderId ${riderId} year ${year} dow ${dow}: ${error.message}`);//th
    } catch (error) {
        throw new Error(`Database error fetching getRidesByYearDOW with riderId ${riderId} year ${year} dow ${dow}: ${error.message}`);//th
    }
}

const getRidesByDOMMonth = async (fastify, riderId, dom, month) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(dom) || dom <0 || dom > 31) {
        throw new TypeError("Invalid parameter: dom (day of month) must be an integer between 1 and 31");
    }

    if ( !isIntegerValue(month) || month < 0 || month > 12) {
        throw new TypeError("Invalid parameter: month must be an integer between 1 and 12");
    }

    const params = [riderId, dom, month];

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_by_dom_month($1, $2, $3)
        `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Database error fetching getRidesByDOMMonth with riderId ${riderId} dom ${dom} month ${month}: ${error.message}`);//th
    } catch (error) {
        throw new Error(`Database error fetching getRidesByDOMMonth with riderId ${riderId} dom ${dom} month ${month}: ${error.message}`);//th
    }
}

const getRidesByDateRange = async (fastify, riderId, startDate, endDate) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isValidDate(startDate) ) {
        throw new TypeError("Invalid parameter: startDate must be a valid date");
    }

    if ( !isValidDate(endDate) ) {
        throw new TypeError("Invalid parameter: endDate must be a valid date");
    }

    const params = [riderId, startDate, endDate];

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_by_date_range($1, $2, $3)
        `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Database error fetching getRidesByDateRange with riderId ${riderId} startDate ${startDate} endDate ${endDate}: ${error.message}`);//th
    } catch (error) {
        throw new Error(`Database error fetching getRidesByDateRange with riderId ${riderId} startDate ${startDate} endDate ${endDate}: ${error.message}`);//th
    }
}

const getRidesByYearTrainer = async (fastify, riderId, year, trainer) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(year)) {
        throw new TypeError("Invalid parameter: year must be an integer");
    }

    if ( typeof(trainer) !== 'boolean') {
        throw new TypeError("Invalid parameter: trainer must be a boolean");
    }

    const params = [riderId, year, trainer];

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_by_year_trainer($1, $2, $3)
        `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Database error fetching getRidesByYearDOW with riderId ${riderId} year ${year} dow ${dow}: ${error.message}`);//th
    } catch (error) {
        throw new Error(`Database error fetching getRidesByYearDOW with riderId ${riderId} year ${year} dow ${dow}: ${error.message}`);//th
    }
}

const getRideById = async (fastify, riderId, rideid) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId, rideid];

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_by_rideid($1, $2);
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows) && rows.length > 0){
            return rows[0];
        }
        return {};

    } catch (error) {
        throw new Error(`Database error fetching getRideById with riderId ${riderId}: ${error.message}`);//th
    }
}

const getSegmentEffortsByRideID = async (fastify, riderId, rideid) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    const params = [riderId, rideid];

    let query = `
        SELECT
            rideid,
            date,
            stravaid,
            effortid,
            elapsed_time,
            moving_time,
            distance,
            starttime,
            endtime,
            average_cadence,
            average_watts,
            average_heartrate,
            max_heartrate,
            name,
            climb_category,
            effort_count,
            rank,
            id
        FROM
            get_ride_segment_efforts($1, $2);
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows) && rows.length >= 0){
            return rows;
        }
        return {};

    } catch (error) {
        throw new Error(`Database error fetching getSegmentEffortsByRideID with riderId ${riderId} rideid ${rideid}: ${error.message}`);//th
    }
}

const getRideByIdQuery = () =>{
    const query = `
    SELECT
        rideid,
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
        coalesce(bikename, 'no bike') as bikename,
        coalesce(stravaname, 'no bike') as stravaname,
        stravaid,
        comment,
        elevationgain,
        elapsedtime,
        powernormalized,
        intensityfactor,
        tss,
        matches,
        trainer,
        elevationloss,
        datenotime,
        device_name,
        fracdim,
        tags,
        calculated_weight_kg,
        cluster,
        hrzones,
        powerzones,
        cadencezones
    FROM
        get_rides_by_rideid($1, $2);
    `;
    return query;
}

const getRidesSearch = async (fastify, riderId, filterParams) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!Array.isArray(filterParams)) {
        return reply.status(400).send({ error: 'Invalid parameter: filterParams must be an array of values or nulls.' });
    }

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_search(
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18
            );
        `;
    const params = [riderId, ...filterParams];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for get_rides_search for riderId ${riderId} years ${JSON.stringify(years)}`);//th

    } catch (error) {
        throw new Error(`Database error fetching get_rides_search with riderId ${riderId} years ${JSON.stringify(years)}: ${error.message}`);//th
    }
}

const getLookback = async (fastify, riderId ) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId]; // Array to store query parameters (starting with riderId)

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg,
            cluster,
            category,
            hrzones,
            powerzones,
            cadencezones
        FROM
            get_rides_lookback_this_day($1)
        ORDER BY
            date asc;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getLookback for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getLookback with riderId ${riderId}: ${error.message}`);//th
    }
}

const updateRide = async (fastify, riderId, rideid, updates) =>{

    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( typeof(updates) !== 'object') {
        throw new TypeError("Invalid parameter: updates must be an objectr");
    }

    // Define allowed fields for update
    const allowedFields = [
        'date', 'distance', 'speedavg', 'speedmax', 'cadence', 'hravg', 'hrmax',
        'title', 'poweravg', 'powermax', 'bikeid', 'stravaid', 'comment',
        'elevationgain', 'elevationloss', 'elapsedtime', 'powernormalized', 'trainer',
        'tss', 'intensityfactor'
    ];

    // Filter out invalid fields
    const sanitizedUpdates = {};
    for (const key of Object.keys(updates)) {
        if (allowedFields.includes(key)) {
            sanitizedUpdates[key] = updates[key];
        }
    }

    // Check if there are no valid fields to update
    if (Object.keys(sanitizedUpdates).length === 0) {
        throw new TypeError("No updates exist to be made.");
    }

    // Input validation
    if (sanitizedUpdates.date) {
        const parsedDate = DateTime.fromFormat(sanitizedUpdates.date, 'yyyy-MM-dd HH:mm:ss');
        if (!parsedDate.isValid) {
            throw new TypeError("Invalid date format (expected YYYY-MM-DD HH:mm:ss)");
        }
        sanitizedUpdates.date = parsedDate.toISO(); // Convert to ISO format
    }

    if (sanitizedUpdates.elapsedTime) {
        try {
            const convertElapsedTime = (timeString) => {
                const [hours, minutes, seconds] = timeString.split(':').map(Number);
                return hours * 3600 + minutes * 60 + seconds;
            };
            sanitizedUpdates.elapsedTime = convertElapsedTime(sanitizedUpdates.elapsedTime);
        } catch (error) {
            throw new TypeError("Invalid elapsedTime format (expected hh:mm:ss)");
        }
    }

    // Sanitize string fields to protect against XSS
    if (sanitizedUpdates.title) sanitizedUpdates.title = xss(sanitizedUpdates.title);
    if (sanitizedUpdates.comment) sanitizedUpdates.comment = xss(sanitizedUpdates.comment);

    // SQL update query
    const setClause = Object.keys(sanitizedUpdates)
        .map((key, index) => `${key.toLowerCase()} = $${index + 1}`)
        .join(', ');

    const query = `
        UPDATE rides
        SET ${setClause}
        WHERE rideid = $${Object.keys(sanitizedUpdates).length + 1} AND riderid = $${Object.keys(sanitizedUpdates).length + 2}
        RETURNING *;`;

    try {
        const values = [...Object.values(sanitizedUpdates), rideid, riderId];
        const result = await fastify.pg.query(query, values);
        if( result.rows.length > 0){
            return result.rows[0];
        }
    } catch (error) {
        throw new Error(`Database error running updateRide for riderId ${riderId}: ${error.message}`);//th
    }
}

const getSegmentEfforts = async (fastify, riderId, segmentId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if( !isIntegerValue(Number(segmentId))){
        throw new TypeError("Invalid parameter: segmentId must be an integer");
    }
    let query = `
    SELECT
        rank,
        id,
        strava_rideid,
        strava_effortid,
        segment_name,
        distance,
        total_elevation_gain,
        start_date,
        elapsed_time,
        moving_time,
        average_cadence,
        average_watts,
        average_heartrate,
        max_heartrate,
        start_index,
        end_index,
        tags
    FROM
        get_segment_effort_rank($1, $2);
    `;
    const params = [riderId, segmentId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getSegmentEfforts for riderId ${riderId} segmentId ${segmentId}`);//th

    } catch (error) {
        throw new Error(`Database error for getSegmentEfforts with riderId ${riderId} segmentId ${segmentId}: ${error.message}`);//th
    }
}

const getSegmentEffortUpdateRequests = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        Select riderid, stravaid, fulfilled from segmentsstravaeffortupdaterequest where riderid = $1 and fulfilled = false;
    `;
    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getSegmentEffortUpdateRequests for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error for getSegmentEffortUpdateRequests with riderId ${riderId}: ${error.message}`);//th
    }
}

const updateSegmentEffortUpdateRequest = async (fastify, riderId, segmentId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if( !isIntegerValue(Number(segmentId))){
        throw new TypeError("Invalid parameter: segmentId must be an integer");
    }

    let query = `
        Update segmentsstravaeffortupdaterequest
        set fulfilled = true
        where riderid = $1 and stravaid = $2 and fulfilled = false;
    `;
    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params, segmentId);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for updateSegmentEffortUpdateRequest for riderId ${riderId} segmentId ${segmentId}`);//th

    } catch (error) {
        throw new Error(`Database error for updateSegmentEffortUpdateRequest with riderId ${riderId} segmentId ${segmentId}: ${error.message}`);//th
    }
}

const getRidesForClusteringByYear = async (fastify, riderId, clusterId) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be an integer");
    }

    const params = [riderId, clusterId];

    const query = `
        SELECT
            a.rideid,
            a.distance,
            a.speedavg,
            a.elevationgain,
            a.hravg,
            a.powernormalized
        FROM
            rides a inner join clusters b
            on a.riderid = b.riderid
        WHERE
            a.riderid = $1
            and b.clusterid = $2
            AND a.distance >= 10
            AND a.speedavg > 1
            AND a.elevationgain > 01
            AND a.hravg > 01
            AND powernormalized > 10
            AND EXTRACT(YEAR FROM date)::INT >= b.startyear
            AND EXTRACT(YEAR FROM date)::INT < (b.endyear+1);
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRidesForClusteringByYear for riderId ${riderId} startYearBack ${startYear} endYearBack${endYear}`);

    } catch (error) {
        throw new Error(`Database error fetching getRidesForClusteringByYear with riderId ${riderId} startYearBack ${startYear} endYearBack${endYear}: ${error.message}`);
    }
}

const updateRidesForClustering = async (fastify, riderId, clusterData) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const insertQuery = `
        INSERT INTO ride_clusters (riderId, rideid, clusterid, cluster)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (riderid, rideid) DO UPDATE
        SET cluster = EXCLUDED.cluster;
    `;

    let count = 0;
    try {
        for (const { rideid, clusterid, cluster } of clusterData) {
            await fastify.pg.query(insertQuery, [riderId, rideid, clusterid, cluster]);
            count++;
        }
    } catch (error) {
        throw new Error(`Database error updating rides for clusters ${riderId}: ${error.message}`);//th
    }
    return count > 0;
}

const updateClusterCentroids = async (fastify, riderId, clusterid, centroids) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterid)) {
        throw new TypeError("Invalid parameter: clusterid must be an integer");
    }

    if ( !Array.isArray(centroids) || centroids.length === 0) {
        throw new TypeError("Invalid parameter: centroids is not valid");
    }

    const insertCentroidQuery = `
        INSERT INTO cluster_centroids (riderid, clusterid, cluster, distance, speedavg, elevationgain, hravg, powernormalized, distance_n, speedavg_n, elevationgain_n, hravg_n, powernormalized_n)
        VALUES ($1, $2, $3, ROUND($4, 2), ROUND($5, 2), ROUND($6, 2), ROUND($7, 2), ROUND($8, 2), ROUND($9, 2), ROUND($10, 2), ROUND($11, 2), ROUND($12, 2), ROUND($13, 2))
        ON CONFLICT (riderid, clusterid, cluster) DO UPDATE
        SET
            distance = ROUND(EXCLUDED.distance, 2),
            speedavg = ROUND(EXCLUDED.speedavg, 2),
            elevationgain = ROUND(EXCLUDED.elevationgain, 2),
            hravg = ROUND(EXCLUDED.hravg, 2),
            powernormalized = ROUND(EXCLUDED.powernormalized, 2),
            distance_n = ROUND(EXCLUDED.distance_n, 2),
            speedavg_n = ROUND(EXCLUDED.speedavg_n, 2),
            elevationgain_n = ROUND(EXCLUDED.elevationgain_n, 2),
            hravg_n = ROUND(EXCLUDED.hravg_n, 2),
            powernormalized_n = ROUND(EXCLUDED.powernormalized_n, 2);
        `;

    let count = 0;
    try {
        centroids.forEach((centroid, clusterIndex) => {
            fastify.pg.query(insertCentroidQuery, [riderId, clusterid, clusterIndex, ...centroid]);
            count++;
        });
    } catch (error) {
        throw new Error(`Database error updating centroids for clusters ${riderId}: ${error.message}`);//th
    }
    try{
        // this updates cluster names assuming Hilly for most elevation, race for most power, easy for lowest hr and temp for what is left.
        const updateClusterNames = 'CALL update_cluster_names($1)';
        await fastify.pg.query(updateClusterNames, [riderId]);
    }
    catch(error){
        throw new Error(`Database error updating centroids names and colors for riderId ${riderId}: ${error.message}`);//th
    }

    return count > 0;
}

const getAllClusterCentroids = async (fastify, riderId) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId];

    let query = `
        SELECT
            b.distance,
            b.speedavg,
            b.elevationgain,
            b.hravg,
            b.powernormalized,
            b.distance_n,
            b.speedavg_n,
            b.elevationgain_n,
            b.hravg_n,
            b.powernormalized_n
        FROM
            clusters a inner join cluster_centroids b
            on a.clusterid = b.clusterid
        WHERE
            a.riderid = $1;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getAllClusterCentroids for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getAllClusterCentroids with riderId ${riderId}: ${error.message}`);//th
    }
}

const getClusterCentroidDefinitions = async (fastify, riderId) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId];

    let query = `
        SELECT
            clusterid,
            startYear,
            endYear,
            cluster,
            distance,
            speedavg,
            elevationgain,
            hravg,
            powernormalized,
            name,
            color,
            ride_count
        FROM
            get_cluster_definitions_with_ride_counts($1)
        ORDER BY
            startYear,
            endYear,
            cluster;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getClusterDefinitions for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getClusterDefinitions with riderId ${riderId}: ${error.message}`);//th
    }
}

const getRidesforCluster = async (fastify, riderId, clusterId, cluster) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be an integer");
    }

    if ( !isIntegerValue(cluster)) {
        throw new TypeError("Invalid parameter: cluster must be an integer");
    }

    let query = `
        SELECT
        rideid,
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
        coalesce(bikename, 'no bike') as bikename,
        coalesce(stravaname, 'no bike') as stravaname,
        stravaid,
        comment,
        elevationgain,
        elapsedtime,
        powernormalized,
        intensityfactor,
        tss,
        matches,
        trainer,
        elevationloss,
        datenotime,
        device_name,
        fracdim,
        tags,
        calculated_weight_kg,
        cluster,
        hrzones,
        powerzones,
        cadencezones
        FROM
            get_all_rides_for_cluster($1, $2, $3);
        `;
    const params = [riderId, clusterId, cluster];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRidesforCluster for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRidesforCluster with riderId ${riderId}: ${error.message}`);//th
    }
}

const getRidesforCentroid = async (fastify, riderId, clusterId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be an integer");
    }

    let query = `
        SELECT
        rideid,
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
        coalesce(bikename, 'no bike') as bikename,
        coalesce(stravaname, 'no bike') as stravaname,
        stravaid,
        comment,
        elevationgain,
        elapsedtime,
        powernormalized,
        intensityfactor,
        tss,
        matches,
        trainer,
        elevationloss,
        datenotime,
        device_name,
        fracdim,
        tags,
        calculated_weight_kg,
        cluster,
        color,
        clusterIndex
        FROM
        get_all_rides_for_cluster($1, $2);
    `;
    const params = [riderId, clusterId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRidesforCluster for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRidesforCluster with riderId ${riderId}: ${error.message}`);//th
    }
}

const getStravaIdForRideId = async (fastify, riderId, rideid) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    let query = `
        SELECT
            stravaid
        FROM
            rides
        WHERE
            riderid = $1
            and rideid = $2;
    `;
    const params = [riderId, rideid];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows[0].stravaid;
        }
        throw new Error(`Invalid data for getStravaIdForRideId for riderId ${riderId} rideid ${rideid}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getStravaIdForRideId with riderId ${riderId} rideid ${rideid}: ${error.message}`);//th
    }
}

const getRideIdForMostRecentMissingStreams = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            a.rideid
        FROM
            rides a left outer join rides_streams b
            on a.rideid = b.rideid
        WHERE
            a.riderid = $1
            and a.stravaid > 0
            and b.rideid is null
        ORDER BY
            a.date desc
        limit 20;
    `;
    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRideIdForMostRecentMissingStreams for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRideIdForMostRecentMissingStreams with riderId ${riderId}: ${error.message}`);//th
    }
}

const getRideIdForMostRecentRides = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            rideid,
            date,
            EXTRACT(YEAR FROM date) AS year
        FROM rides
        WHERE
            riderid = $1
            AND insertDttm >= NOW() - INTERVAL '2 hours'
        ORDER BY
            insertDttm;
    `;
    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRideIdForMostRecentRides for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRideIdForMostRecentRides with riderId ${riderId}: ${error.message}`);//th
    }
}

const getDistinctClusterCentroids = async (fastify, riderId) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId];

    let query = `
        SELECT
            clusterid,
            startyear,
            endyear,
            clustercount,
            active
        FROM
            clusters
        WHERE
            riderid = $1
        ORDER BY
            startYear,
            endYear,
            clustercount;`;
    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getDistinctClusterCentroids for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getDistinctClusterCentroids with riderId ${riderId}: ${error.message}`);//th
    }
}

const getClusterDefinition = async (fastify, riderId, clusterId) =>{
    // Returns the single record that defines the clustering to do for the requested clusterid.
    // It should return only one record if valid and zero records if invalid.
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be integers");
    }

    const params = [riderId, clusterId];

    let query = `
        SELECT
            clusterid,
            startyear,
            endyear,
            clustercount,
            fields,
            active
        FROM
            clusters
        WHERE
            riderid = $1
            and clusterid = $2;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getClusterDefinition for riderId ${riderId} clusterid ${clusterId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getClusterDefinition with riderId ${riderId} clusterid ${clusterId}: ${error.message}`);//th
    }
}

const getAllClusterDefinitions = async (fastify, riderId) =>{
    // Returns the all cluster definitions for the riderid.
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId];

    let query = `
        SELECT
            clusterid,
            startyear,
            endyear,
            clustercount,
            fields,
            active
        FROM
            clusters
        WHERE
            riderid = $1
        ORDER BY
            startyear,
            endyear;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getAllClusterDefinitions for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getAllClusterDefinitions for riderId ${riderId}: ${error.message}`);//th
    }
}

const getActiveCentroid = async (fastify, riderId) =>{
    // Returns the single record that defines the clustering to do for the requested riderId
    // It should return only one record if valid and zero records if invalid.
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId];

    let query = `
        SELECT
            clusterid
        FROM
            clusters
        WHERE
            riderid = $1
            and active = true
            limit 1;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows) && rows.length > 0){
            return rows[0].clusterid;
        }
        return null

    } catch (error) {
        throw new Error(`Database error fetching getActiveCentroid with riderId ${riderId}: ${error.message}`);//th
    }
}

const setClusterActive = async (fastify, riderId, clusterId) =>{
    // Set the selected cluster to be active and sets all other clusters to be inactive
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be an integer");
    }

    const params = [riderId, clusterId];

    let query = `
        UPDATE public.clusters
        SET active = CASE
                        WHEN clusterid = $2 THEN TRUE
                        ELSE FALSE
                    END
        WHERE riderid = $1;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for clusterSetActive for riderId ${riderId} clusterId ${clusterId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getActiveCentroid with riderId ${riderId} clusterId ${clusterId}: ${error.message}`);//th
    }
}

const getClusterCentroids = async (fastify, riderId, clusterid) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterid)) {
        throw new TypeError("Invalid parameter: clusterid must be a valid balue");
    }

    const params = [riderId, clusterid];

    let query = `
        SELECT
            a.clusterid,
            a.startyear,
            a.endyear,
            b.cluster,
            b.distance,
            b.speedavg,
            b.elevationgain,
            b.hravg,
            b.powernormalized
        FROM
            clusters a inner join cluster_centroids b
            on a.clusterid = b.clusterid
        WHERE
            a.riderid = $1
            and a.clusterid = $2;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getClusterCentroids for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getClusterCentroids with riderId ${riderId}: ${error.message}`);//th
    }
}

const setClusterCentroidName = async (fastify, riderId, clusterId, clusterNumber, name) =>{
    // Set the selected cluster to be active and sets all other clusters to be inactive
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be an integer");
    }

    if ( !isIntegerValue(clusterNumber)) {
        throw new TypeError("Invalid parameter: clusterNumber must be an integer");
    }

    if ( typeof(name) !== 'string') {
        throw new TypeError("Invalid parameter: name must be valid text");
    }

    const params = [riderId, clusterId, clusterNumber, name];

    let query = `
        UPDATE public.cluster_centroids
        SET name = $4
        WHERE riderid = $1 and clusterid = $2 and cluster = $3
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for setClusterCentroidName for riderId ${riderId} clusterId ${clusterId} cluster ${clusterNumber}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getActiveCentroid with riderId ${riderId} clusterId ${clusterId} cluster ${clusterNumber}: ${error.message}`);//th
    }
}

const setClusterCentroidColor = async (fastify, riderId, clusterId, clusterNumber, color) =>{
    // Set the selected cluster to be active and sets all other clusters to be inactive
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be an integer");
    }

    if ( !isIntegerValue(clusterNumber)) {
        throw new TypeError("Invalid parameter: clusterNumber must be an integer");
    }

    if ( typeof(color) !== 'string') {
        throw new TypeError("Invalid parameter: color must be valid text");
    }

    const params = [riderId, clusterId, clusterNumber, color];

    let query = `
        UPDATE public.cluster_centroids
        SET color = $4
        WHERE riderid = $1 and clusterid = $2 and cluster = $3
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for setClusterCentroidColor for riderId ${riderId} clusterId ${clusterId} cluster ${clusterNumber}`);//th

    } catch (error) {
        throw new Error(`Database error fetching setClusterCentroidColor with riderId ${riderId} clusterId ${clusterId} cluster ${clusterNumber}: ${error.message}`);//th
    }
}

const upsertCluster = async (fastify, riderId, clusterId, startyear, endyear, clustercount, fields, active) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    try{
        const { rows } = await fastify.pg.query(`
            INSERT INTO public.clusters (riderid, startyear, endyear, clustercount, fields, active)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (riderid, startyear, endyear)
            DO UPDATE SET
                clustercount = EXCLUDED.clustercount,
                fields = EXCLUDED.fields,
                active = EXCLUDED.active,
                insertdttm = CURRENT_TIMESTAMP
            RETURNING clusterid;`,  [
                riderId,
                startyear,
                endyear,
                clustercount,
                fields,
                active,
                ]
            );
         return rows[0]?.clusterid;
    }
    catch(err){
        console.error('Database error in upsertCluster:', err);
        return null;
    }
}

const deleteCluster = async (fastify, riderId, clusterId) =>{
    // Set the selected cluster to be active and sets all other clusters to be inactive
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(clusterId)) {
        throw new TypeError("Invalid parameter: clusterId must be an integer");
    }

    const params = [riderId, clusterId];

    const query = `
       SELECT delete_cluster($1, $2);
    `;
    try {
        await fastify.pg.query(query, params);

    } catch (error) {
        throw new Error(`Database error fetching deleteCluster with riderId ${riderId} clusterId ${clusterId}: ${error.message}`);//th
    }
}

const getRideMetricsById = async (fastify, riderId, rideid) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    let query = `
        SELECT
            metric,
            period,
            metric_value,
            starttime
        FROM
            get_ride_metric_detail($1,$2)
        ORDER BY
            metric;
    `;
    const params = [riderId, rideid];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRideMetrricsById for riderId ${riderId} rideid ${rideid}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRideMetrricsById with riderId ${riderId} rideid ${rideid}: ${error.message}`);//th
    }
}

const getRideMatchesById = async (fastify, riderId, rideid) => {
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isIntegerValue(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    let query = `
        SELECT
            type,
            period,
            targetpower,
            actualperiod,
            maxaveragepower,
            averagepower,
            peakpower,
            averageheartrate,
            starttime
        FROM
            get_ride_matches($1, $2);
    `;
    const params = [riderId, rideid];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRideMatchesById for riderId ${riderId} rideid ${rideid}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRideMatchesById with riderId ${riderId} rideid ${rideid}: ${error.message}`);//th
    }
}

const getStreaks_1_day = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            start_date,
            end_date,
            streak_length
        FROM
            get_rider_streaks_1_day($1);
    `;

    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getStreaks_1_day for riderId ${riderId}`);

    } catch (error) {
        throw new Error(`Database error fetching getStreaks_1_day with riderId ${riderId}: ${error.message}`);
    }
}

const getStreaks_7days200 = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            start_date,
            end_date,
            streak_length
        FROM
            get_rider_streaks_7_day($1);
    `;

    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getStreaks_1_day for riderId ${riderId}`);

    } catch (error) {
        throw new Error(`Database error fetching getStreaks_1_day with riderId ${riderId}: ${error.message}`);
    }
}

const getReferencePowerLevels = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            level,
            rank,
            sec0005,
            sec0060,
            sec0300,
            sec1200
        FROM
            get_rider_reference_powerlevels($1);
    `;

    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getReferencePowerLevels for riderId ${riderId}`);

    } catch (error) {
        throw new Error(`Database error fetching getReferencePowerLevels with riderId ${riderId}: ${error.message}`);
    }
}

const getRiderPowerCurve = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            a.duration_seconds,
            a.max_power_watts,
            a.max_power_wkg,
            a.period,
            a.rideid,
            b.date,
            b.stravaid,
            b.title
        FROM
            power_curve a inner join rides b
            on a.rideid = b.rideid
        WHERE
            a.riderid = $1
        ORDER BY
            a.duration_seconds;
    `;

    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRiderPowerCurve for riderId ${riderId}`);

    } catch (error) {
        throw new Error(`Database error fetching getRiderPowerCurve with riderId ${riderId}: ${error.message}`);
    }
}

const getRideMetricsBinaryDetail = async (fastify, riderId, rideid) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isInteger(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    const params = [riderId, rideid];

    let query = `
        SELECT
            a.watts,
            a.heartrate,
            a.cadence,
            a.velocity_smooth,
            a.altitude,
            a.distance,
            a.temperature,
            a.location,
            a.time
        FROM
        	ride_metrics_binary a inner join rides b
            on a.rideid = b.rideid
        	and b.riderid = $1
        WHERE
            a.rideid =$2;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows) && rows.length > 0){
            return {
                watts: decompressIntBuffer(rows[0].watts, Uint16Array),
                heartrate: decompressIntBuffer(rows[0].heartrate, Uint16Array),
                cadence: decompressIntBuffer(rows[0].cadence, Uint16Array),
                velocity_smooth: decompressFloatBuffer(rows[0].velocity_smooth, Float32Array),
                altitude: decompressIntBuffer(rows[0].altitude, Uint16Array),
                distance: decompressFloatBuffer(rows[0].distance, Float32Array),
                temperature: decompressIntBuffer(rows[0].temperature, Uint16Array),
                location: (() => {
                    const floatArray = decompressFloatBuffer(rows[0].location, Float32Array);
                    const locations = [];
                    for (let i = 0; i < floatArray.length; i += 2) {
                        locations.push([floatArray[i], floatArray[i + 1]]);
                    }
                    return locations;
                })()
            };
        }
        return {};

    } catch (error) {
        throw new Error(`Database error fetching getRideMetricsBinaryDetail with riderId ${riderId} rideid ${rideid}: ${error.message}`);//th
    }
}

const getRideLocationBinaryDetail = async (fastify, riderId, rideid) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if ( !isInteger(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    const params = [riderId, rideid];

    let query = `
        SELECT
            a.location
        FROM
        	ride_metrics_binary a inner join rides b
            on a.rideid = b.rideid
        	and b.riderid = $1
        WHERE
            a.rideid =$2;
    `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows) && rows.length > 0){
            return {
                location: (() => {
                    const floatArray = decompressFloatBuffer(rows[0].location, Float32Array);
                    const locations = [];
                    for (let i = 0; i < floatArray.length; i += 2) {
                        locations.push([floatArray[i], floatArray[i + 1]]);
                    }
                    return locations;
                })()
            };
        }
        return {};

    } catch (error) {
        throw new Error(`Database error fetching getRideLocationBinaryDetail with riderId ${riderId} rideid ${rideid}: ${error.message}`);//th
    }
}

const calculatePowerCurve = async (fastify, riderId, rideid) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(rideid)){
      throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    // 1. Get the ride data
    let query = `
        SELECT
            b.watts
        FROM
            rides a left outer join ride_metrics_binary b
            on a.rideid = b.rideid
        WHERE
            a.riderid = $1
            and a.rideid = $2;`;

    const params = [riderId, rideid];
    const { rows } = await fastify.pg.query(query, params);

    if(!Array.isArray(rows) || rows.length === 0){
        return 0;
    }

    let updatesMade = 0;
    try{
        const compressedBuffer = rows[0]?.watts; // Buffer from PostgreSQL
        if( !Buffer.isBuffer(compressedBuffer)){
            return 0;
        }
        const decompressedData = zlib.inflateSync(compressedBuffer); // Decompress
        const decompressedUint8Array = new Uint8Array(decompressedData); // Convert to Uint8Array

        // Convert to Uint16Array (Ensure proper alignment)
        if (decompressedUint8Array.length % 2 !== 0) {
            throw new Error('Decompressed byte length is not a multiple of 2');
        }

        const wattsArray = new Uint16Array(decompressedUint8Array.buffer);

        // Define commonly used time intervals (seconds)
        // 2. Calculate best power for each duration
        const bestPower = {};
        for (const duration of POWER_CURVE_INTERVALS) {
            if (duration <= wattsArray.length) {
                const { metric_value } = nSecondAverageMax(wattsArray, duration, 0, RollingAverageType.MAX);
                bestPower[duration] = metric_value;
            } else {
                bestPower[duration] = 0;
            }
        }

        // 3. Store computed power curve in ride_metrics_binary
        const powerCurveBuffer = Buffer.from(JSON.stringify(bestPower));
        await fastify.pg.query(`
            UPDATE
                ride_metrics_binary
            SET
                power_curve = $1
            WHERE
                rideid = $2
            `,
          [powerCurveBuffer, rideid]
        );

        // 4. Retrieve the rider's weight
        const getriderWeightLbs =  await fastify.pg.query(`
            SELECT
                getriderWeight
            FROM
                getRiderWeight($1, null, $2);
            `,
          [riderId, rideid]
        );

        const weightInKg = getriderWeightLbs?.rows &&  getriderWeightLbs.rows.length > 0 ? 0.45359237 * getriderWeightLbs.rows[0].getriderweight : 150 * 0.45359237;

        // 5. Update overall power curve if new values exceed existing records
        for (const [duration, power] of Object.entries(bestPower)) {
            const wattsPerKg = power / weightInKg;

            const existing = await fastify.pg.query(`
                SELECT
                    max_power_watts
                FROM
                    power_curve
                WHERE
                    riderid = $1
                    AND duration_seconds = $2
                    AND period = $3
                `,
              [riderId, duration, 'overall']
            );

            if (existing.rowCount === 0 || power > existing.rows[0].max_power_watts) {
                if( power > 0){
                    // Only update if power is greater than 0
                    await fastify.pg.query(`
                        INSERT INTO
                            power_curve (riderid, duration_seconds, max_power_watts, max_power_wkg, period, rideid)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (riderid, duration_seconds, period)
                        DO UPDATE SET max_power_watts = EXCLUDED.max_power_watts,
                            max_power_wkg = EXCLUDED.max_power_wkg,
                            rideid = EXCLUDED.rideid,
                            insertdttm = NOW()`,
                        [riderId, duration, power, wattsPerKg, 'overall', rideid]
                        );
                        updatesMade++;
                }
            }
        }
        return updatesMade
    }
    catch(err){
        console.error('Error in calculatePowerCurve:', err);
        return updatesMade
    }
    finally{
        return updatesMade
    }
}

const calculateRideBoundingBoxForRideId = async (fastify, riderId, rideid) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(rideid)){
      throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    // 1. Get the ride location data
    const result = await getRideLocationBinaryDetail(fastify, riderId, rideid);

    // 2. Calculate the bounding box
    const boundingBox = calculateRideBoundingBox(result.location);
    if( boundingBox.minlatitude === 0 && boundingBox.minlongitude === 0 && boundingBox.maxlatitude === 0 && boundingBox.maxlongitude === 0){
        return 0;
    }

    // 3. Upsert the bounding box data intp the rides_boundingbox table.
    let updatesMade = 0;
    try{
        const query = `
            INSERT INTO public.rides_boundingbox (
                rideid, minlatitude, minlongitude, maxlatitude, maxlongitude, centerlatitude, centerlongitude
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (rideid)
            DO UPDATE SET
                minlatitude = EXCLUDED.minlatitude,
                minlongitude = EXCLUDED.minlongitude,
                maxlatitude = EXCLUDED.maxlatitude,
                maxlongitude = EXCLUDED.maxlongitude,
                centerlatitude = EXCLUDED.centerlatitude,
                centerlongitude = EXCLUDED.centerlongitude;
        `;
        const params = [
            rideid,
            boundingBox.minlatitude,
            boundingBox.minlongitude,
            boundingBox.maxlatitude,
            boundingBox.maxlongitude,
            boundingBox.centerlatitude,
            boundingBox.centerlongitude
        ];
        await fastify.pg.query(query, params);
        updatesMade++;
    }
    catch(err){
        console.error('Error in calculateRideBoundingBoxForRideId:', err);
        return updatesMade;
    }
    finally{
        return updatesMade
    }
}

const calculatFractalDimensionForRideId = async (fastify, riderId, rideid) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(rideid)){
      throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    // 1. Get the ride location data
    const result = await getRideLocationBinaryDetail(fastify, riderId, rideid);

    // 2. Calculate the fractal dimension
    const fractalDimension = roundValue(calculateRideFractalDimension(result.location), 4);

    // 3. Update the fractal dimension field in the rides table.
    let updatesMade = 0;
    try{
        const query = `
            UPDATE
                rides
            SET
                fracDim = $3
            WHERE
                riderid = $1
                AND rideid = $2;
        `;
        const params = [
            riderId,
            rideid,
            fractalDimension
        ];
        await fastify.pg.query(query, params);
        updatesMade++;
    }
    catch(err){
        console.error('Error in calculatFractalDimensionForRideId:', err);
        return updatesMade;
    }
    finally{
        return updatesMade
    }
}

const refreshPowerCurveForYear = async (fastify, riderId, year) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(year)){
      throw new TypeError("Invalid parameter: year must be a valid year");
    }

    let query = `
        SELECT
            rideid
        FROM
            rides
        WHERE
            riderid = $1
            and EXTRACT(YEAR FROM date) = $2
        ORDER BY
            date;
        `;

    const params = [riderId, year];
    const { rows } = await fastify.pg.query(query, params);

    if(!Array.isArray(rows) || rows.length === 0){
        throw new Error(`No power data found for riderid: ${riderid} rideId: ${rideid}`);
    }
    let updatesMade = 0;
    for( let i = 0; i < rows.length; i++){
        await calculatePowerCurve(fastify, riderId, rows[i].rideid);
        updatesMade++;
    }
    return updatesMade;
}

const calculateRideBoundingBoxForYear = async (fastify, riderId, year) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(year)){
      throw new TypeError("Invalid parameter: year must be a valid year");
    }

    let query = `
        SELECT
            a.rideid
        FROM
            rides a left outer join rides_boundingbox b
            on a.rideid = b.rideid
        WHERE
            riderid = $1
            and EXTRACT(YEAR FROM date) = $2
            and b.rideid is null
        ORDER BY
            a.rideid;
        `;

    const params = [riderId, year];
    const { rows } = await fastify.pg.query(query, params);

    if(!Array.isArray(rows) || rows.length === 0){
        throw new Error(`No rides with missing bounding box data were found for riderid: ${riderId} year: ${year}`);
    }
    let updatesMade = 0;
    for( let i = 0; i < rows.length; i++){
        await calculateRideBoundingBoxForRideId(fastify, riderId, rows[i].rideid);
        updatesMade++;
    }
    return updatesMade;
}

const calculateRideFractalDimensionForYear = async (fastify, riderId, year) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(year)){
      throw new TypeError("Invalid parameter: year must be a valid year");
    }

    let query = `
        SELECT
            rideid
        FROM
            rides
        WHERE
            riderid = $1
            and EXTRACT(YEAR FROM date) = $2
            and fracDim = 0.0 or fracDim is null
        ORDER BY
            rideid;
     `;

    const params = [riderId, year];
    const { rows } = await fastify.pg.query(query, params);

    if(!Array.isArray(rows) || rows.length === 0){
        throw new Error(`No rides with missing fractal dimension were found for riderid: ${riderId} year: ${year}`);
    }
    let updatesMade = 0;
    for( let i = 0; i < rows.length; i++){
        await calculatFractalDimensionForRideId(fastify, riderId, rows[i].rideid);
        updatesMade++;
    }
    return updatesMade;
}

const calculatePowerCurveMultiple = async (fastify, riderId, rideids, periodName) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if (!isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!Array.isArray(rideids) || rideids.length === 0 || !rideids.every(isIntegerValue)) {
        throw new TypeError("Invalid parameter: rideids must be an array of integers");
    }

    if (typeof periodName !== "string" || periodName.trim() === "") {
        throw new TypeError("Invalid parameter: periodName must be a non-empty string");
    }

    let overallBestPower = {};

    // Process each ride and compute its power curve
    for (const rideid of rideids) {
        const query = `
            SELECT
                b.watts
            FROM
                rides a LEFT OUTER JOIN ride_metrics_binary b
                ON a.rideid = b.rideid
            WHERE
                a.riderid = $1 AND a.rideid = $2;
        `;

        const { rows } = await fastify.pg.query(query, [riderId, rideid]);

        if (!Array.isArray(rows) || rows.length === 0) {
            continue;
        }

        try {
            const compressedBuffer = rows[0]?.watts;
            if (!Buffer.isBuffer(compressedBuffer)) {
                continue;
            }

            const decompressedData = zlib.inflateSync(compressedBuffer);
            const decompressedUint8Array = new Uint8Array(decompressedData);

            if (decompressedUint8Array.length % 2 !== 0) {
                throw new Error("Decompressed byte length is not a multiple of 2");
            }

            const wattsArray = new Uint16Array(decompressedUint8Array.buffer);

            const bestPower = {};
            for (const duration of POWER_CURVE_INTERVALS) {
                if (duration <= wattsArray.length) {
                    const { metric_value } = nSecondAverageMax(wattsArray, duration, 0, RollingAverageType.MAX);
                    bestPower[duration] = metric_value;
                } else {
                    bestPower[duration] = 0;
                }
            }

            // Retrieve rider's weight for this ride
            const weightQuery = `
                SELECT getriderWeight FROM getRiderWeight($1, NULL, $2);
            `;
            const weightResult = await fastify.pg.query(weightQuery, [riderId, rideid]);
            const weightInKg = weightResult?.rows?.length > 0
                ? 0.45359237 * weightResult.rows[0].getriderweight
                : 150 * 0.45359237;

            // Update overall power curve with best values found
            for (const duration of POWER_CURVE_INTERVALS) {
                const power = bestPower[duration] || 0;
                if (power > (overallBestPower[duration]?.watts || 0)) {
                    overallBestPower[duration] = {
                        watts: power,
                        wattsPerKg: power / weightInKg,
                        rideid,
                        weightInKg
                    };
                }
            }
        } catch (err) {
            console.error("Error processing ride:", rideid, err);
        }
    }

    // Update the power_curve table with the best power values
    let updatesMade = 0;
    for (const [duration, powerData] of Object.entries(overallBestPower)) {
        const { watts, wattsPerKg, rideid } = powerData;

        const existing = await fastify.pg.query(
            `
            SELECT max_power_watts FROM power_curve
            WHERE riderid = $1 AND duration_seconds = $2 AND period = $3
            `,
            [riderId, duration, periodName]
        );

        if (existing.rowCount === 0 || watts > existing.rows[0].max_power_watts) {
            if (watts > 0) {
                await fastify.pg.query(
                    `
                    INSERT INTO power_curve (riderid, duration_seconds, max_power_watts, max_power_wkg, period, rideid)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (riderid, duration_seconds, period)
                    DO UPDATE SET
                        max_power_watts = EXCLUDED.max_power_watts,
                        max_power_wkg = EXCLUDED.max_power_wkg,
                        rideid = EXCLUDED.rideid,
                        insertdttm = NOW()
                    `,
                    [riderId, duration, watts, wattsPerKg, periodName, rideid]
                );
                updatesMade++;
            }
        }
    }
    return updatesMade;
};

const rideDetailData = async (fastify, riderId, rideid) => {
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(rideid)){
      throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    // 1. Get the ride data
    let query = `
        SELECT
            a.date AS start_datetime,
            b.watts,
            b.heartrate,
            b.cadence,
            b.velocity_smooth,
            b.altitude,
            b.distance,
            b.temperature,
            b.location,
            b.time
        FROM
            rides a
            LEFT JOIN ride_metrics_binary b ON a.rideid = b.rideid
        WHERE
            a.riderid = $1 AND a.rideid = $2;
    `;

    const params = [riderId, rideid];
    const { rows } = await fastify.pg.query(query, params);

    if(!Array.isArray(rows) || rows.length === 0){
        return 0;[]
    }

    const ride = rows[0];
    const startTime = new Date(ride.start_datetime);

    // Decompress all binary fields
    const wattsArray = decompressIntBuffer(ride.watts);
    const heartrateArray = decompressIntBuffer(ride.heartrate);
    const cadenceArray = decompressIntBuffer(ride.cadence);
    const velocityArray = decompressFloatBuffer(ride.velocity_smooth);
    const altitudeArray = decompressIntBuffer(ride.altitude);
    const distanceArray = decompressFloatBuffer(ride.distance);
    const temperatureArray = decompressIntBuffer(ride.temperature);
    const timeArray = decompressIntBuffer(ride.time);

    // Determine the length based on the longest array
    const maxLength = Math.max(
        wattsArray.length,
        heartrateArray.length,
        cadenceArray.length,
        velocityArray.length,
        altitudeArray.length,
        distanceArray.length,
        temperatureArray.length,
        timeArray.length,
    );

    const csvData = [];
    for (let i = 0; i < maxLength; i++) {
        const timestamp = new Date(startTime.getTime() + (timeArray[i]) * 1000);
        csvData.push({
            index: i + 1,
            time: formatDateTimeYYYYMMDDHHmmss(timestamp),
            watts: wattsArray[i] ?? 0,
            heartrate: heartrateArray[i] ?? 0,
            cadence: cadenceArray[i] ?? 0,
            velocity_smooth: roundValue(convertMetersPerSecondToMilesPerHour(velocityArray[i] ?? 0),4) ,
            altitude: roundValue(convertMetersToFeet(altitudeArray[i] ?? 0),0),
            distance: roundValue(convertMetersToMiles(distanceArray[i] ?? 0),4),
            temperature: roundValue(convertCelsiusToFahrenheit(temperatureArray[i] ?? 0),1),
            elapsed_seconds: timeArray[i] ?? 0,
        });
    }
    return csvData
}

const getRidesWithSimilarRoutes = async (fastify, riderId, rideid) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg
        FROM
            get_similar_ride_routes($1, $2);
    `;
    const params = [riderId, rideid];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRidesWithSimilarRoutes for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRidesWithSimilarRoutes with riderId ${riderId}: ${error.message}`);//th
    }
}

const getRidesWithSimilarEfforts = async (fastify, riderId, rideid) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    if (!isIntegerValue(rideid)) {
        throw new TypeError("Invalid parameter: rideid must be an integer");
    }

    let query = `
        SELECT
            rideid,
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
            coalesce(bikename, 'no bike') as bikename,
            coalesce(stravaname, 'no bike') as stravaname,
            stravaid,
            comment,
            elevationgain,
            elapsedtime,
            powernormalized,
            intensityfactor,
            tss,
            matches,
            trainer,
            elevationloss,
            datenotime,
            device_name,
            fracdim,
            tags,
            calculated_weight_kg
        FROM
            get_similar_ride_efforts($1, $2);
    `;
    const params = [riderId, rideid];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRidesWithSimilarRoutes for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRidesWithSimilarRoutes with riderId ${riderId}: ${error.message}`);//th
    }
}

const getMilestoness_TenK = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            ride_date,
            distance_miles
        FROM
            get_rider_distance_milestones($1)
        ORDER BY
            ride_date;
    `;

    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getMilestoness_TenK for riderId ${riderId}`);

    } catch (error) {
        throw new Error(`Database error fetching getMilestoness_TenK with riderId ${riderId}: ${error.message}`);
    }
}

const getOutdoorIndoor = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        SELECT
            year,
            distance_outdoor,
            distance_indoor,
            total_distance,
            pct_outdoor,
            pct_indoor
        FROM
            get_yearly_trainer_distance_summary($1)
        ORDER BY
            year desc;
    `;

    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for get_yearly_trainer_distance_summary for riderId ${riderId}`);

    } catch (error) {
        throw new Error(`Database error fetching get_yearly_trainer_distance_summary with riderId ${riderId}: ${error.message}`);
    }
}

const getRideDayFractions = async (fastify, riderId) =>{
    if(!isFastify(fastify)){
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if( !isRiderId(riderId)){
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    let query = `
        Select
            year_month,
            ride_days_count,
            days_in_month,
            fraction_of_days_with_rides
        from
            get_rider_ride_day_fractions($1)
        Order by
            year_month desc;
    `;

    const params = [riderId];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRideDayFractions for riderId ${riderId}`);

    } catch (error) {
        throw new Error(`Database error fetching getRideDayFractions with riderId ${riderId}: ${error.message}`);
    }
}

module.exports = {
    getFirstSegmentEffortDate,
    getStarredSegments,
    upsertRides,
    upsertStarredSegment,
    upsertStarredSegmentEffort,
    updateSegmentStats,
    processRideSegments,
    processRideStreams,
    updateStarredSegments,
    processSegmentEfforts,
    upsertWeight,
    getWeightTrackerData,
    getWeightPeriodData,
    getCummulatives,
    getCummulativesByYear,
    getYearAndMonth,
    getYearAndDOW,
    getMonthAndDOM,
    getDashboard,
    getRidesLastMonth,
    getRidesHistory,
    getRidesByDate,
    getRidesByYearMonth,
    getRidesByYearDOW,
    getRidesByDOMMonth,
    getRidesByDateRange,
    getRidesforCluster,
    getRidesByYearTrainer,
    getRideById,
    getSegmentEffortsByRideID,
    getRideByIdQuery,
    getRidesSearch,
    getStravaIdForRideId,
    getRideIdForMostRecentMissingStreams,
    getRideIdForMostRecentRides,
    getLookback,
    updateRide,
    getSegmentEfforts,
    getSegmentEffortUpdateRequests,
    updateSegmentEffortUpdateRequest,
    getRidesForClusteringByYear,
    updateRidesForClustering,
    updateClusterCentroids,
    getAllClusterCentroids,
    getRidesforCentroid,
    getClusterCentroidDefinitions,
    getDistinctClusterCentroids,
    getClusterDefinition,
    getAllClusterDefinitions,
    getActiveCentroid,
    setClusterActive,
    getClusterCentroids,
    setClusterCentroidName,
    setClusterCentroidColor,
    upsertCluster,
    deleteCluster,
    getRideMetricsById,
    getRideMatchesById,
    getStreaks_1_day,
    getStreaks_7days200,
    getReferencePowerLevels,
    getRiderPowerCurve,
    getRideMetricsBinaryDetail,
    getRideLocationBinaryDetail,
    calculatePowerCurve,
    refreshPowerCurveForYear,
    calculatePowerCurveMultiple,
    calculateRideBoundingBoxForRideId,
    calculatFractalDimensionForRideId,
    calculateRideBoundingBoxForYear,
    calculateRideFractalDimensionForYear,
    rideDetailData,
    getRidesWithSimilarRoutes,
    getRidesWithSimilarEfforts,
    getMilestoness_TenK,
    getOutdoorIndoor,
    getRideDayFractions,
};

