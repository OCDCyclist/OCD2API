const axios = require('axios');
const { isEmpty } = require('../utility/general');

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;
const powerFactor = 1.025;

function removeTrailingZ(inputString) {
    if( typeof(inputString) !== 'string' ) return '';
    if (inputString.endsWith("Z")) {
        return inputString.slice(0, -1);
    }
    return inputString;
}

function convertToImperial(activity) {
    const METERS_TO_MILES = 0.000621371;
    const METERS_TO_FEET = 3.28084;
    const MPS_TO_MPH = 2.23694;  // meters per second to miles per hour

    return{
        start_date_local: removeTrailingZ(activity.start_date_local),
        distance: (activity.distance * METERS_TO_MILES).toFixed(1),
        average_speed: (activity.average_speed * MPS_TO_MPH).toFixed(1),
        max_speed: (activity.max_speed * MPS_TO_MPH).toFixed(2),
        average_cadence: (activity.average_cadence).toFixed(0),
        average_heartrate: (activity.average_heartrate).toFixed(0),
        max_heartrate: (activity.max_heartrate).toFixed(0),
        name: activity.name,
        average_watts: (activity.average_watts).toFixed(0),
        max_watts: (activity.max_watts).toFixed(0),
        gear_id: activity.gear_id,
        id: activity.id,
        total_elevation_gain: (activity.total_elevation_gain * METERS_TO_FEET).toFixed(0),
        moving_time: activity.moving_time,
        weighted_average_watts: activity.weighted_average_watts,
        type: activity.type
    }
}

function convertSegmentToImperial(segment) {
    const METERS_TO_MILES = 0.000621371;
    const METERS_TO_FEET = 3.28084;

    return{
        id: segment.id,
        name: segment.name,
        distance: (segment.distance * METERS_TO_MILES).toFixed(1),
        average_grade: segment.average_grade,
        maximum_grade: segment.maximum_grade,
        elevation_high: (segment.elevation_high * METERS_TO_FEET).toFixed(0),
        elevation_low: (segment.elevation_low * METERS_TO_FEET).toFixed(0),
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

function convertSegmentEffortToImperial(segmentEffort) {
    const METERS_TO_MILES = 0.000621371;
    return{
        id: segmentEffort.segment.id,
        stravaid: segmentEffort.activity.id,
        elapsed_time: segmentEffort.elapsed_time,
        moving_time: segmentEffort.moving_time,
        start_date: removeTrailingZ(segmentEffort.start_date_local),
        distance: (segmentEffort.distance * METERS_TO_MILES).toFixed(1),
        start_index: segmentEffort.start_index,
        end_index: segmentEffort.end_index,
        average_cadence: (segmentEffort.average_cadence).toFixed(0),
        average_watts: (segmentEffort.average_watts).toFixed(0),
        average_heartrate: (segmentEffort.average_heartrate).toFixed(0),
        max_heartrate:  (segmentEffort.max_heartrate).toFixed(0)
    }
}

async function stravaRoutes(fastify, options) {

    async function convertGearIdToOCD(client, riderid, stravaGear_Id){
        const query = 'Select bikeid from bikes where riderid = $1 and stravaid = $2 limit 1';
        const params = [riderid, stravaGear_Id];
        const { rows } = await client.query(query, params);
        // If no bike is found, return adefault bike
        if (rows.length === 0) {
            return 2581;
        }
        return rows[0].bikeid;
    }

    async function getStravaCredentials() {
        let query = 'SELECT clientid, clientsecret FROM stravaapi LIMIT 1';
        const client = await fastify.pg.connect();

        try {
            const { rows } = await client.query(query, []);

            if (rows.length === 0) {
                return null;
            }
            return rows[0];
        } catch (err) {
            console.error('Database error in getStravaCredentials:', err);
            return null;
        }
        finally{
            client.release();
        }
    }

    async function getStravaTokens(riderId) {
        const client = await fastify.pg.connect();
        try{
            const res = await client.query('SELECT accesstoken, refreshtoken, accesstokenexpires FROM stravaapirider WHERE riderid = $1', [riderId]);
            return res.rows[0];
        }
        catch(err){
            console.error('Database error in getStravaTokens:', err);
            return null;
        }
        finally{
            client.release();
        }
    }

    function isTokenExpired(accessToken) {
        const now = Math.floor(Date.now() / 1000);  // Current time in Unix timestamp (seconds)

        // Assuming you store the expiration time of the access token when refreshing it
        const expirationTime = parseInt(accessToken.accesstokenexpires, 10);

        return expirationTime <= now;
    }

    async function refreshStravaToken(riderId, refreshToken, clientId, clientSecret) {
        const response = await axios.post('https://www.strava.com/oauth/token', {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token'
        });

        const newAccessToken = response.data.access_token;
        const newRefreshToken = response.data.refresh_token;
        const expiresAt = response.data.expires_at;  // Unix timestamp

        // Update the new tokens and expiration time in the database
        const client = await fastify.pg.connect();
        await client.query(`
          UPDATE stravaapirider
          SET accesstoken = $1, refreshtoken = $2, accesstokenexpires = $3
          WHERE riderid = $4
        `, [newAccessToken, newRefreshToken, expiresAt, riderId]);

        return newAccessToken;
    }

    async function getStravaRecentRides(accessToken, limit = 30) {
        const response = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { per_page: limit }
        });
        return response.data;
    }

    async function getStravaStarredSegments(accessToken, limit = 100) {
        const response = await axios.get('https://www.strava.com/api/v3/segments/starred', {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { per_page: limit }
        });
        return response.data;
    }

    async function getStravaActivityById(accessToken, stravaid) {
        const url = `https://www.strava.com/api/v3/activities/${stravaid}?include_all_efforts=true`;
        const response = await axios.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data;
    }

    async function getStravaAthleteDetail(accessToken) {
        const url = `https://www.strava.com/api/v3/athlete`;
        const response = await axios.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data;  // This is a single object
    }

    async function upsertRides(riderId, rides) {
        const client = await fastify.pg.connect();
        let ridesAdded = 0;
        for (const ride of rides) {
          const existingRide = await client.query('SELECT 1 FROM rides WHERE riderid = $1 AND stravaid = $2', [riderId, ride.id]);
          if (existingRide.rowCount === 0) {
            const client = await fastify.pg.connect();

            ride.gear_id = await convertGearIdToOCD(client, riderId, ride.gear_id);
            const rideImperial = convertToImperial(ride);

            try{
                await client.query(`
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
            finally{
                client.release();
            }
          }
        }
        return ridesAdded;
    }

    async function upsertStarredSegment(client, riderId, segment) {
        if (isEmpty(segment) || 'id' in segment === false) { return false; }

        const existingStarredSegment = await client.query('SELECT 1 FROM segmentsstrava WHERE riderid = $1 AND id = $2', [riderId, segment.id]);
        if (existingStarredSegment.rowCount === 0) {
            const segmentImperial = convertSegmentToImperial(segment);
            try{
                await client.query(`
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
                return true;
            }
            catch(err){
                console.error('Database error inserting new segmentsstrava:', err);
                return false;
            }
        }
        return true;
    }

    async function upsertStarredSegmentEffort(client, riderId, segmentEffort) {
        if (isEmpty(segmentEffort) || 'id' in segmentEffort === false) { return false; }

        const existingSegmentEffort = await client.query('SELECT 1 FROM segmentsstravaefforts WHERE riderid = $1 AND id = $2 AND stravaid = $3', [riderId, segmentEffort.segment.id, segmentEffort.activity.id]);
        if (existingSegmentEffort.rowCount === 0) {
            const segmentImperial = convertSegmentEffortToImperial(segmentEffort);
            try{
                await client.query(`
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
                        segmentImperial.id,
                        segmentImperial.stravaid,
                        segmentImperial.elapsed_time,
                        segmentImperial.moving_time,
                        segmentImperial.start_date,
                        segmentImperial.distance,
                        segmentImperial.start_index,
                        segmentImperial.end_index,
                        segmentImperial.average_cadence,
                        segmentImperial.average_watts,
                        segmentImperial.average_heartrate,
                        segmentImperial.max_heartrate
                        ]
                    );
                return true;
            }
            catch(err){
                console.error('Database error inserting new segmentsstrava:', err);
                return false;
            }
        }
        return true;
    }

    async function processRideSegments(client, riderId, stravaRideDetail) {
        if( isEmpty(stravaRideDetail)) return false;

        if('segment_efforts' in stravaRideDetail){
            for (const key in stravaRideDetail.segment_efforts) {
                if (stravaRideDetail.segment_efforts.hasOwnProperty(key)) {
                    const segmentEffort = stravaRideDetail.segment_efforts[key];
                    if( segmentEffort?.segment?.starred){
                        // Make sure that the starred segment exists in OCD Cyclist db.
                        if( await upsertStarredSegment(client, riderId, segmentEffort.segment)){
                            // Now insert the segment effort
                            await upsertStarredSegmentEffort(client, riderId, segmentEffort);
                        }
                    }
                }
            }

        }
    }

    async function updateStarredSegments(riderId, starredSegments) {
        if( isEmpty(starredSegments) || !Array.isArray(starredSegments) || starredSegments.length === 0) return false;

        const client = await fastify.pg.connect();

        for( const segmentKey in starredSegments){
            const segment = starredSegments[segmentKey];
            const segmentImperial = convertSegmentToImperial(segment);
            try{
                await client.query(`
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
            }
            catch(err){
                console.error('Database error inserting new segmentsstrava:', err);
            }
        }
        client.release();
    }

    fastify.get('/rider/updateStrava', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;  // request.user is populated after JWT verification

        const stravaCredentials = await getStravaCredentials();
        let tokens = await getStravaTokens(riderId);

        if (isTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        // Retrieve recent rides from Strava
        const recentRides = await getStravaRecentRides(tokens.accesstoken);
        const ridesAdded = await upsertRides(riderId, recentRides);

        reply.send({
            success: true,
            ridesChecked: Array.isArray(recentRides) ? recentRides.length : 0,
            ridesAdded: ridesAdded
        });

        setImmediate(async () => {
            const client = await fastify.pg.connect();

            // After successfully checking for new ride(s), check for segments and other details
            try{
                for( let i = 0; i < recentRides.length; i++){
                    const ride = recentRides[i];
                    // Retrieve recent ride details from Strava with segment and other information
                    const stravaRideDetail = await getStravaActivityById(tokens.accesstoken, ride.id);
                    await processRideSegments(client, riderId, stravaRideDetail);
                }
            }
            catch (databaseError) {
                console.error('Error updating segment efforts', databaseError);
                // More error handling later.
            }

            try {
                // this updates ride metrics like intensity factor, TSS
                const updaterideMetrics = 'CALL public.updateAllRiderMetrics($1)';
                await client.query(updaterideMetrics, [riderId]);
            } catch (updateError) {
                console.error('Error updating ride metrics', updateError);
                // More error handling later.
            }
            finally{
                client.release();
            }
        });
    });

    fastify.get('/rider/updateStarredSegments', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;

        const stravaCredentials = await getStravaCredentials();
        let tokens = await getStravaTokens(riderId);

        if (isTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        // Retrieve recent rides from Strava
        const starredSegmentsResponse = await getStravaStarredSegments(tokens.accesstoken);

        reply.send({ starredSegmentsResponse });

        setImmediate(async () => {
            updateStarredSegments(riderId, starredSegmentsResponse);
        });
    });

    fastify.get('/rider/viewRecent', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;  // request.user is populated after JWT verification

        const stravaCredentials = await getStravaCredentials();
        let tokens = await getStravaTokens(riderId);

        //tokens.accesstoken = await refreshStravaToken(riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);

        if (isTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        // Retrieve recent rides from Strava
        const recentRides = await getStravaRecentRides(tokens.accesstoken);

        reply.send(recentRides);
    });

    fastify.get('/rider/getActivityDetail/:stravaid', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;  // request.user is populated after JWT verification
        const { stravaid } = request.params;

        const id = parseInt(riderId, 10);
        if (isNaN(id)) {
          return reply.code(400).send({ error: 'Invalid or missing riderId' });
        }

        const stravaidNumber = parseInt(stravaid, 10);
        if (isNaN(stravaidNumber)) {
          return reply.code(400).send({ error: 'Invalid or missing stravaid' });
        }

        const stravaCredentials = await getStravaCredentials();
        let tokens = await getStravaTokens(riderId);

        //tokens.accesstoken = await refreshStravaToken(riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);

        if (isTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        // Retrieve recent rides from Strava
        const stravaRideDetail = await getStravaActivityById(tokens.accesstoken, stravaid);

        reply.send(stravaRideDetail);
    });

    fastify.get('/rider/getAthleteDetail', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;  // request.user is populated after JWT verification

        const id = parseInt(riderId, 10);
        if (isNaN(id)) {
          return reply.code(400).send({ error: 'Invalid or missing riderId' });
        }

        const stravaCredentials = await getStravaCredentials();
        let tokens = await getStravaTokens(riderId);

        if (isTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        // Retrieve recent rides from Strava
        const stravaRideDetail = await getStravaAthleteDetail(tokens.accesstoken);

        reply.send(stravaRideDetail);
    });

    // Route to redirect user to Strava's OAuth page
    fastify.get('/strava/auth/strava', (request, reply) => {
        const authorizationUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${STRAVA_REDIRECT_URI}&scope=read,activity:read_all&approval_prompt=auto`;

        reply.redirect(authorizationUrl);
    });

    // Route to handle callback after user authorizes
    fastify.get('/strava/callback', async (request, reply) => {
        const { code } = request.query;

        if (!code) {
            return reply.code(400).send({ error: 'Authorization code is missing.' });
        }

        try {
            // Exchange authorization code for access token
            const tokenResponse = await axios.post('https://www.strava.com/oauth/token', {
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code'
            });

            const { access_token, refresh_token, expires_at } = tokenResponse.data;

            reply.send({
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: expires_at
            });
        } catch (error) {
            fastify.log.error(error);
            reply.code(500).send({ error: 'Failed to retrieve access token.' });
        }
    });

    // Route to refresh access token
    fastify.get('/strava/refresh-token', async (request, reply) => {
        const { refreshToken } = request.query;

        if (!refreshToken) {
            return reply.code(400).send({ error: 'Refresh token is missing.' });
        }

        try {
            // Refresh the access token
            const refreshResponse = await axios.post('https://www.strava.com/oauth/token', {
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            });

            const { access_token, refresh_token, expires_at } = refreshResponse.data;

            reply.send({
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: expires_at
            });
        } catch (error) {
            fastify.log.error(error);
            reply.code(500).send({ error: 'Failed to refresh access token.' });
        }
    });
}

module.exports = stravaRoutes;
