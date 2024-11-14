const axios = require('axios');

const { getFirstSegmentEffortDate,
        upsertRides,
        updateSegmentStats,
        updateStarredSegments,
        processRideSegments,
        processSegmentEfforts,
} = require('../db/dbQueries');
const { getStravaCredentials,
        getStravaTokens,
        isStravaTokenExpired,
        refreshStravaToken,
        getStravaToken,
} = require('../db/stravaAdmin');
const { getStravaRecentRides,
        getStravaStarredSegments,
        getStravaSegmentById,
        getStravaActivityById,
        getStravaAthleteDetail,
        getStravaSegmentEffortsForRider,
} = require('../db/stravaRideData');

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;

const defaultBikeId = 2581;

async function stravaRoutes(fastify, options) {
    fastify.get('/rider/updateStrava', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;  // request.user is populated after JWT verification

        const stravaCredentials = await getStravaCredentials(fastify);
        let tokens = await getStravaTokens(fastify, riderId);

        if (isStravaTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        const recentRides = await getStravaRecentRides(tokens.accesstoken);
        const ridesAdded = await upsertRides(fastify, riderId, recentRides, defaultBikeId);

        reply.send({
            success: true,
            ridesChecked: Array.isArray(recentRides) ? recentRides.length : 0,
            ridesAddedCount: ridesAdded.length,
            ridesAdded: ridesAdded
        });

        setImmediate(async () => {
            // After successfully checking for new ride(s), check for segments and other details
            try{
                for( let i = 0; i < recentRides.length; i++){
                    const ride = recentRides[i];
                    // Retrieve recent ride details from Strava with segment and other information
                    const stravaRideDetail = await getStravaActivityById(tokens.accesstoken, ride.id);
                    await processRideSegments(fastify, riderId, stravaRideDetail, tokens);
                }
            }
            catch (databaseError) {
                console.error('Error updating segment efforts', databaseError);
            }

            try {
                // this updates ride metrics like intensity factor, TSS
                const updaterideMetrics = 'CALL public.updateAllRiderMetrics($1)';
                await fastify.pg.query(updaterideMetrics, [riderId]);
            } catch (updateError) {
                console.error('Error updating ride metrics', updateError);
            }
        });
    });

    fastify.get('/rider/updateStarredSegments', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;

        let tokens = await getStravaToken(fastify, riderId);

        const starredSegmentsResponse = await getStravaStarredSegments(tokens.accesstoken);

        reply.send({ starredSegmentsResponse });

        setImmediate(async () => {
            await updateStarredSegments(fastify, riderId, starredSegmentsResponse, tokens);
        });
    });

    fastify.get('/rider/updateSegmentById/:segmentId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;
        const { segmentId } = request.params;

        const id = parseInt(riderId, 10);
        if (isNaN(id)) {
          return reply.code(400).send({ error: 'Invalid or missing riderId' });
        }

        const testId = parseInt(segmentId, 10);
        if (isNaN(testId)) {
          return reply.code(400).send({ error: 'Invalid or missing segmentId' });
        }

        const stravaCredentials = await getStravaCredentials(fastify);
        let tokens = await getStravaTokens(fastify, riderId);

        if (isStravaTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        const segmentResponse = await getStravaSegmentById(tokens.accesstoken, segmentId);

        reply.send({ segmentResponse });

        setImmediate(async () => {
            updateSegmentStats(fastify, riderId, segmentResponse);
        });
    });

    fastify.get('/rider/updateSegmentEfforts/:segmentId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;
        const { segmentId } = request.params;

        const id = parseInt(riderId, 10);
        if (isNaN(id)) {
          return reply.code(400).send({ error: 'Invalid or missing riderId' });
        }

        const testId = parseInt(segmentId, 10);
        if (isNaN(testId)) {
          return reply.code(400).send({ error: 'Invalid or missing segmentId' });
        }

        const stravaCredentials = await getStravaCredentials(fastify);
        let tokens = await getStravaTokens(fastify, riderId);

        if (isStravaTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        reply.send({ message: `Segment effort update started for ${segmentId}` });

        setImmediate(async () => {
            try{
                const earliestDate = await getFirstSegmentEffortDate(fastify, riderId, Number(segmentId));
                const segmentEfforts = await getStravaSegmentEffortsForRider(tokens.accesstoken, segmentId, riderId, earliestDate ? earliestDate : null );
                await processSegmentEfforts(fastify, riderId, segmentEfforts);
            }
            catch(err){
                console.log(`Unhandled error in updateSegmentEfforts: ${err}`);
            }
        });
    });

    fastify.get('/rider/viewRecent', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;

        const stravaCredentials = await getStravaCredentials(fastify);
        let tokens = await getStravaTokens(fastify, riderId);

        if (isStravaTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

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

        const stravaCredentials = await getStravaCredentials(fastify);
        let tokens = await getStravaTokens(fastify, riderId);

        if (isStravaTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
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

        const stravaCredentials = await getStravaCredentials(fastify);
        let tokens = await getStravaTokens(fastify, riderId);

        if (isStravaTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
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
