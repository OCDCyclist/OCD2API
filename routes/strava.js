const axios = require('axios');

const { getFirstSegmentEffortDate,
        upsertRides,
        updateSegmentStats,
        updateStarredSegments,
        processRideSegments,
        processSegmentEfforts,
        processRideStreams,
        getActiveCentroid,
        getStravaIdForRideId,
        getRideIdForMostRecentMissingStreams,
        calculateRideBoundingBoxForRideId,
        updateCummulatives,
        updateFFFMetrics,
        updateRuns,
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
        getStravaActivityStreamsById,
        getStravaAthleteDetail,
        getStravaSegmentEffortsForRider,
} = require('../db/stravaRideData');
const { clusterRides } = require('../utility/clustering');
const { writeActivityFileToBucket } = require('../utility/bucketUtilities');
const { logDetailMessage } = require("../utility/general");

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const STRAVA_REDIRECT_URI = process.env.STRAVA_REDIRECT_URI;

const defaultBikeId = 2581;

function getYesterdayDateString() {
    const today = new Date();
    today.setDate(today.getDate() - 1);
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function stravaRoutes(fastify, options) {
    fastify.get('/rider/updateStrava', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;  // request.user is populated after JWT verification

        const stravaCredentials = await getStravaCredentials(fastify);
        let tokens = await getStravaTokens(fastify, riderId);

        if (isStravaTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        const recentRides = await getStravaRecentRides(tokens.accesstoken);
        logDetailMessage('Retrieve recent rides', 'rider', riderId);

        const ridesAdded = await upsertRides(fastify, riderId, recentRides, defaultBikeId);
        logDetailMessage('Rides added', 'rider', riderId);

        reply.send({
            success: true,
            ridesChecked: Array.isArray(recentRides) ? recentRides.length : 0,
            ridesAddedCount: ridesAdded.length,
            ridesAdded: ridesAdded
        });

        setImmediate(async () => {
            // After successfully checking for new ride(s), check for
            //  segments and other details
            try{
                for( let i = 0; i < ridesAdded.length; i++){
                    const ride = ridesAdded[i];
                    // Retrieve recent ride details from Strava with segment and other information
                    const stravaRideDetail = await getStravaActivityById(tokens.accesstoken, ride.id);
                    await processRideSegments(fastify, riderId, stravaRideDetail, tokens);
                    logDetailMessage('processRideSegments', 'ride', ride.id);
                }
            }
            catch (databaseError) {
                console.error('Error updating segment efforts', databaseError);
            }

            // Then retrieve the streams for the ride(s), write to file, and insert file name into database.
            // Write files to digital ocean S3 compatible bucket.
            try{
                for( let i = 0; i < ridesAdded.length; i++){
                    const ride = ridesAdded[i];
                    const stravaRideDetail = await getStravaActivityStreamsById(tokens.accesstoken, ride.id);
                    await processRideStreams(fastify, riderId, ride.rideid, ride.id, stravaRideDetail);
                    logDetailMessage('processRideStreams', 'ride', ride.id);
                }
            }
            catch (databaseError) {
                console.error('Error updating segment efforts', databaseError);
            }
            try {
                // this updates ride metrics like intensity factor, TSS.  This call should be fast now
                if(ridesAdded.length > 0){
                    const updaterideMetrics = 'CALL public.updateAllRiderMetrics($1)';
                    await fastify.pg.query(updaterideMetrics, [riderId]);
                    logDetailMessage('updaterideMetrics', 'rider', riderId);

                }
            } catch (updateError) {
                console.error('Error updating ride metrics', updateError);
            }

            try {
                // this updates cummulatives
                const dateToUse = getYesterdayDateString();

                const [cummulativesOk, fffOk] = await Promise.all([
                    updateCummulatives(fastify, riderId, dateToUse),
                    updateFFFMetrics(fastify, riderId, dateToUse),
                    updateRuns(fastify, riderId, dateToUse)
                ]);
                logDetailMessage('updateCummulatives', 'dateToUse', cummulativesOk);
                logDetailMessage('updateFFFMetrics', 'dateToUse', fffOk);

            } catch (updateError) {
                console.error('Error updating cummulatives', updateError);
            }

            // This updates the default cluster for the riderId
            try {
                if(ridesAdded.length > 0){
                    const activeClusterId = await getActiveCentroid(fastify,riderId);
                    if( activeClusterId === null) { return;}
                    await clusterRides(fastify, riderId, activeClusterId);
                    const updateClusterTags = 'CALL update_ride_clusters_with_tags($1,$2)';
                    await fastify.pg.query(updateClusterTags, [riderId, activeClusterId]);
                    logDetailMessage('update_ride_clusters_with_tags', 'activeClusterId', activeClusterId);
                }
            } catch (error) {
                console.error('Error clustering rides:', error);
            }

            // update the ride bounding box
            try{
                for( let i = 0; i < ridesAdded.length; i++){
                    const ride = ridesAdded[i];
                    await calculateRideBoundingBoxForRideId(fastify, riderId, ride.rideid);
                    logDetailMessage('processRideBoundingBox', 'ride', ride.rideid);
                }
            }
            catch (databaseError) {
                console.error('Error updating ride bounding box', databaseError);
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

     fastify.get('/rider/writeActivityStreams/:stravaid', { preValidation: [fastify.authenticate] }, async (request, reply) => {
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

        let rideid = -1;
        const result = await fastify.pg.query('SELECT rideid FROM rides WHERE riderid = $1 AND stravaid = $2', [riderId, stravaid]);
        if(result && result.rows && result.rows.length > 0){
            rideid = result.rows[0].rideid;
        }
        if( rideid < 0){
          return reply.code(400).send({ error: 'Invalid or missing rideid for this stravaid' });
        }

        const stravaRideDetail = await getStravaActivityStreamsById(tokens.accesstoken, stravaid);
        const filename = await writeActivityFileToBucket(fastify, riderId, rideid, stravaid, stravaRideDetail);
        reply.send(filename);
    });


    fastify.get('/rider/getActivityStreams/:rideid', { preValidation: [fastify.authenticate] }, async (request, reply) => {
        const { riderId } = request.user;  // request.user is populated after JWT verification
        const { rideid } = request.params;

        const id = parseInt(riderId, 10);
        if (isNaN(id)) {
          return reply.code(400).send({ error: 'Invalid or missing riderId' });
        }

        const rideIdValue = parseInt(rideid, 10);
        if (isNaN(rideIdValue)) {
          return reply.code(400).send({ error: 'Invalid or missing rideid' });
        }

        const stravaCredentials = await getStravaCredentials(fastify);
        let tokens = await getStravaTokens(fastify, riderId);

        if (isStravaTokenExpired(tokens)) {
          tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
        }

        try{
            const stravaidNumber = await getStravaIdForRideId(fastify, riderId, rideIdValue);
            const stravaRideDetail = await getStravaActivityStreamsById(tokens.accesstoken, stravaidNumber);
            await processRideStreams(fastify, riderId, rideIdValue, stravaidNumber, stravaRideDetail);
        }
        catch (databaseError) {
            console.error('Error updating segment efforts', databaseError);
        }

        reply.send({processed: true, rideid: rideIdValue, stravaId: stravaidNumber});
    });

    fastify.get('/rider/getActivityStreams/updateMissing', { preValidation: [fastify.authenticate] }, async (request, reply) => {
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

        const proceessed = [];
        let rides = undefined
        try{
           rides = await getRideIdForMostRecentMissingStreams(fastify, id);
        }
        catch(error){
            console.error('Unable to update streams', databaseError);
            reply.send({processed: false});
        }

        for(let i = 0; i < rides.length; i++){
            const ride = rides[i];
            try{
                const stravaidNumber = await getStravaIdForRideId(fastify, id, ride.rideid);
                const stravaRideDetail = await getStravaActivityStreamsById(tokens.accesstoken, stravaidNumber);
                await processRideStreams(fastify, id, ride.rideid, stravaidNumber, stravaRideDetail);
                proceessed.push(ride.rideid);
            }
            catch(error){
                console.error(`Error updating streams for ride ${ride.rideid}`, databaseError);
            }
        }

        reply.send({processed: true});
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
            fastify.log.error('Failed to retrieve access token.');
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
            fastify.log.error('Failed to refresh access token.');
            fastify.log.error(error);
            reply.code(500).send({ error: 'Failed to refresh access token.' });
        }
    });
}

module.exports = stravaRoutes;
