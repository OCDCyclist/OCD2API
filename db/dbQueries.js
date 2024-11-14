const xss = require("xss");
const dayjs = require('dayjs');
const { isRiderId, isRideId, isSegmentId, isFastify, isEmpty, isValidDate, isValidNumber } = require("../utility/general");
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

    if( !isSegmentId(segmentId)){
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
              ridesAdded.push(rideImperial);
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
      calculated_weight_kg
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
        a.rideid,
        a.date,
        a.distance,
        a.speedavg,
        a.speedmax,
        a.cadence,
        a.hravg,
        a.hrmax,
        a.title,
        a.poweravg,
        a.powermax,
        a.bikeid,
        coalesce(b.bikename, 'no bike') as bikename,
        coalesce(b.stravaname, 'no bike') as stravaname,
        a.stravaid,
        a.comment,
        a.elevationgain,
        a.elapsedtime,
        a.powernormalized,
        a.intensityfactor,
        a.tss,
        a.matches,
        a.trainer,
        a.elevationloss,
        a.datenotime,
        a.device_name,
        a.fracdim
      FROM
        rides a left outer join bikes b
        on a.bikeid = b.bikeid
      WHERE
        a.riderid = $1
        AND EXTRACT(YEAR FROM a.date) = ANY($2)
      ORDER BY
        a.date ASC;
      `;
    const params = [riderId, years];

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRidesHistory for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRidesHistory with riderId ${riderId}: ${error.message}`);//th
    }
}

const getRides = async (fastify, riderId, dateFrom, dateTo) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    // Validate dateFrom and dateTo if they are present
    let queryConditions = 'WHERE riderid = $1'; // Initialize base condition
    const params = [riderId]; // Array to store query parameters (starting with riderId)

    if (dateFrom && dayjs(dateFrom, 'YYYY-MM-DD', true).isValid()) {
        queryConditions += ` AND date >= $2`; // Add condition for dateFrom
        params.push(dateFrom);
    }

    if (dateTo && dayjs(dateTo, 'YYYY-MM-DD', true).isValid()) {
        // Add one day to dateTo and subtract one second
        const adjustedDateTo = dayjs(dateTo).add(1, 'day').subtract(1, 'second').format('YYYY-MM-DD HH:mm:ss');
        queryConditions += ` AND date <= $${params.length + 1}`; // Add condition for dateTo
        params.push(adjustedDateTo); // Add adjusted dateTo to the parameters
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
        fracdim
        FROM
            Rides ${queryConditions}
        ORDER BY date DESC
        `;

    try {
        const { rows } = await fastify.pg.query(query, params);
        if(Array.isArray(rows)){
            return rows;
        }
        throw new Error(`Invalid data for getRides for riderId ${riderId}`);//th

    } catch (error) {
        throw new Error(`Database error fetching getRides with riderId ${riderId}: ${error.message}`);//th
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
        a.rideid,
        a.date,
        a.distance,
        a.speedavg,
        a.speedmax,
        a.cadence,
        a.hravg,
        a.hrmax,
        a.title,
        a.poweravg,
        a.powermax,
        a.bikeid,
        coalesce(b.bikename, 'no bike') as bikename,
        coalesce(b.stravaname, 'no bike') as stravaname,
        a.stravaid,
        a.comment,
        a.elevationgain,
        a.elapsedtime,
        a.powernormalized,
        a.intensityfactor,
        a.tss,
        a.matches,
        a.trainer,
        a.elevationloss,
        a.datenotime,
        a.device_name,
        a.fracdim
      FROM
        rides a left outer join bikes b
        on a.bikeid = b.bikeid
      WHERE
        a.riderid = $1
        and a.rideid = $2
        limit 1;
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

const getLookback = async (fastify, riderId ) =>{
    if (!isFastify(fastify)) {
        throw new TypeError("Invalid parameter: fastify must be provided");
    }

    if ( !isRiderId(riderId)) {
        throw new TypeError("Invalid parameter: riderId must be an integer");
    }

    const params = [riderId]; // Array to store query parameters (starting with riderId)

    let query = `
      Select
        rideid,
        category,
        date,
        distance,
        speedavg,
        elapsedtime,
        elevationgain,
        hravg,
        poweravg
        bikeid,
        stravaid,
        title,
        comment
      From
        get_rider_lookback_this_day($1)
      Order By date asc;
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

module.exports = {
    getFirstSegmentEffortDate,
    getStarredSegments,
    upsertRides,
    upsertStarredSegment,
    upsertStarredSegmentEffort,
    updateSegmentStats,
    processRideSegments,
    updateStarredSegments,
    processSegmentEfforts,
    upsertWeight,
    getWeightTrackerData,
    getCummulatives,
    getYearAndMonth,
    getYearAndDOW,
    getMonthAndDOM,
    getDashboard,
    getRidesLastMonth,
    getRidesHistory,
    getRides,
    getRideById,
    getLookback,
    updateRide,
};