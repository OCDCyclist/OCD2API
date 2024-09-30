const axios = require('axios');

const STRAVA_CLIENT_ID = '6574';
const STRAVA_CLIENT_SECRET = 'a563e451d156298698620b04956c6e84dd988df6';   // Replace with your client secret
const STRAVA_REDIRECT_URI = 'http://localhost:3000/strava/callback'; // Replace with your redirect URI

async function stravaRoutes(fastify, options) {
    // Define the Strava routes

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
