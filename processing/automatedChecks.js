
const { getStravaCredentials,
    getStravaTokens,
    isStravaTokenExpired,
    refreshStravaToken,
} = require('../db/stravaAdmin');
const {
    processRideStreams,
    getStravaIdForRideId,
    getRideIdForMostRecentMissingStreams,
    getRideIdForMostRecentRides,
    calculatePowerCurveMultiple,
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

const updatePowerCurve = async (fastify) => {
    const riderId = 1; // hardwired for now

    const stravaCredentials = await getStravaCredentials(fastify);
    let tokens = await getStravaTokens(fastify, riderId);

    if (isStravaTokenExpired(tokens)) {
      tokens.accesstoken = await refreshStravaToken(fastify, riderId, tokens.refreshtoken, stravaCredentials.clientid, stravaCredentials.clientsecret);
    }

    let rides = undefined
    try{
        rides = await getRideIdForMostRecentRides(fastify, riderId);
    }
    catch(error){
        console.error('Unable to update streams', databaseError);
        return;
    }

    // Grouping rideids by year
    const groupedRides = rides.reduce((acc, { year, rideid }) => {
        const yearKey = year.toString();
        if (!acc[yearKey]) {
            acc[yearKey] = { year: parseInt(yearKey, 10), rideids: [] };
        }
        acc[yearKey].rideids.push(rideid);
    return acc;
    }, {});

    const resultArray = Object.values(groupedRides);

    for(let i = 0; i < resultArray.length; i++){
        const yearToUpdate = resultArray[i];
        try{
            await calculatePowerCurveMultiple(fastify, riderId, yearToUpdate.rideids, yearToUpdate.year.toString());
        }
        catch(error){
            console.error(`Error updating power curve for year: ${yearToUpdate.year} rideids: ${yearToUpdate.rideids.join(",")}`, error);
        }
    }
};

module.exports = {
    updateMissingStreams, updatePowerCurve
};

