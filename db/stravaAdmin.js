const axios = require('axios');
const { isFastify, isRiderId } = require('../utility/general');

async function getStravaCredentials(fastify) {
    if(!isFastify(fastify)) return;

    let query = 'SELECT clientid, clientsecret FROM stravaapi LIMIT 1';

    try {
        const { rows } = await fastify.pg.query(query, []);

        if (rows.length === 0) {
            throw new Error(`No stravapi credentials`);
        }
        return rows[0];
    } catch (error) {
        throw new Error(`Database error fetching getStravaCredentials: ${error.message}`);
    }
}

async function getStravaTokens(fastify, riderId) {
    if(!isFastify(fastify)) return null;
    if(!isRiderId(riderId)) return null;

    try{
        const res = await fastify.pg.query('SELECT accesstoken, refreshtoken, accesstokenexpires FROM stravaapirider WHERE riderid = $1', [riderId]);

        if (res.rows.length === 0) {
            throw new Error(`No strava tokens`);
        }
        return res.rows[0];
    }
    catch(err){
        throw new Error(`Database error fetching getStravaTokens: ${error.message}`);
    }
}

const isStravaTokenExpired = (accessToken) => {
    if( !accessToken || ('accesstokenexpires' in accessToken) === false) return true;

    const now = Math.floor(Date.now() / 1000);  // Current time in Unix timestamp (seconds)

    // Assuming you store the expiration time of the access token when refreshing it
    const expirationTime = parseInt(accessToken.accesstokenexpires, 10);

    return expirationTime <= now;
}

async function refreshStravaToken(fastify, riderId, refreshToken, clientId, clientSecret) {
    const response = await axios.post('https://www.strava.com/oauth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;
    const expiresAt = response.data.expires_at;  // Unix timestamp

    try{
        await fastify.pg.query(`
            UPDATE stravaapirider
            SET accesstoken = $1, refreshtoken = $2, accesstokenexpires = $3
            WHERE riderid = $4
          `, [newAccessToken, newRefreshToken, expiresAt, riderId]);

          return newAccessToken;
    }
    catch(error){
        throw new Error(`Database error fetching refreshStravaToken: ${error.message}`);
    }
}

module.exports = { getStravaCredentials, getStravaTokens, isStravaTokenExpired, refreshStravaToken };