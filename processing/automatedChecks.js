
const { getStravaCredentials,
    getStravaTokens,
    isStravaTokenExpired,
    refreshStravaToken,
} = require('../db/stravaAdmin');
const {
    processRideStreams,
    getStravaIdForRideId,
    getRideIdForMostRecentMissingStreams,
} = require('../db/dbQueries');
const {
    getStravaActivityStreamsById,
} = require('../db/stravaRideData');


const updateMissingStreams = async (fastify) => {
    const riderId = 1; // hardwired for now

    const stravaCredentials = await getStravaCredentials(fastify);
    let tokens = await getStravaTokens(fastify, riderId);

    if (isStravaTokenExpired(tokens)) {
      tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
    }

    let rides = undefined
    try{
        rides = await getRideIdForMostRecentMissingStreams(fastify, riderId);
    }
    catch(error){
        console.error('Unable to update streams', databaseError);
        return;
    }

    for(let i = 0; i < rides.length; i++){
        const ride = rides[i];
        try{
            const stravaidNumber = await getStravaIdForRideId(fastify, riderId, ride.rideid);
            const stravaRideDetail = await getStravaActivityStreamsById(tokens.accesstoken, stravaidNumber);
            await processRideStreams(fastify, riderId, ride.rideid, stravaidNumber, stravaRideDetail);
        }
        catch(error){
            console.error(`Error updating streams for ride ${ride.rideid}`, databaseError);
        }
    }
};

module.exports = {
    updateMissingStreams
};

