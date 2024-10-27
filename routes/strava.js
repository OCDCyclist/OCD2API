const axios = require('axios');

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;

function removeTrailingZ(inputString) {
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
        return response.data;  // This is an array of rides
    }

    async function getStravaActivityById(accessToken, stravaid) {
        const url = `https://www.strava.com/api/v3/activities/${stravaid}?include_all_efforts=true`;
        const response = await axios.get(url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.data;  // This is a single object
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

    fastify.get('/rider/updateStrava', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;  // request.user is populated after JWT verification

        const stravaCredentials = await getStravaCredentials();
        let tokens = await getStravaTokens(riderId);

        //tokens.accesstoken = await refreshStravaToken(riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);

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

        // After successfully checking for new ride(s), update cummulatives and other things
        const client = await fastify.pg.connect();
        setImmediate(async () => {
            try {
                // this updates ride metrics like intensity factor, TSS
                const updaterideMetrics = 'CALL public.updateAllRiderMetrics($1)';
                await client.query(updaterideMetrics, [riderId]);
            } catch (updateError) {
                console.error('Error updating ride metrics', updateError);
                // More error handling later.
            }
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
