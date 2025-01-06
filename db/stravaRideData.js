const axios = require('axios');
const { isFastify, isRiderId } = require('../utility/general');
const { getRoundedCurrentDateISO, getSixMonthsEarlier, getFiveYearsEarlier} = require('../utility/dates');
const dayjs = require('dayjs');

async function convertGearIdToOCD(fastify, riderid, stravaGear_Id, defaultBikeId){
    if(!isFastify(fastify)) return null;
    if(!isRiderId(riderid)) return null;

    const query = 'Select bikeid from bikes where riderid = $1 and stravaid = $2 limit 1';
    const params = [riderid, stravaGear_Id];

    try{
        const { rows } = await fastify.pg.query(query, params);
        // If no bike is found, return a default bike
        if (rows.length === 0) {
            return defaultBikeId;
        }
        return rows[0].bikeid;
    }
    catch(error){
        console.log(`Database error in convertGearIdToOCD: ${error.message}`);
        return defaultBikeId;
    }
}

async function getStravaRecentRides(accessToken, limit = 30) {
    const response = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { per_page: limit }
    });
    return response.data;
}

async function getStravaStarredSegments(accessToken, limit = 200) {
    const response = await axios.get('https://www.strava.com/api/v3/segments/starred', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { per_page: limit }
    });
    return response.data;
}

async function getStravaSegmentById(accessToken, segmentId) {
    const response = await axios.get(`https://www.strava.com/api/v3/segments/${segmentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { per_page: 1 }
    });
    return response.data;
}

async function getStravaSegmenEffortsById(accessToken, segmentId, startData, endDate) {
    const response = await axios.get(`https://www.strava.com/api/v3/segment_efforts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        segment_id: segmentId,
        start_date_local: startData,
        end_date_local: endDate,
        per_page: 200
     }
    });
    return response;
}

async function getStravaActivityById(accessToken, stravaid) {
    const url = `https://www.strava.com/api/v3/activities/${stravaid}?include_all_efforts=true`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
}

async function getStravaActivityStreamsById(accessToken, stravaid) {
    const url = `https://www.strava.com/api/v3/activities/${stravaid}/streams`;
    // Define the streams you want to fetch (or use 'all' for all streams)
    const params = {
        keys: 'time,latlng,distance,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,heading',
        key_by_type: true, // Groups streams by type
    };

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params
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

async function getStravaSegmentEffortsForRider(accessToken, segmentId, riderId, endDate = null) {
    // If no endDate is provided, use the current date rounded up to the nearest day
    endDate = endDate ? dayjs(endDate).startOf('day').toISOString() : getRoundedCurrentDateISO();

    let startDate = getFiveYearsEarlier(endDate);
    //let startDate = getTwelveMonthsEarlier(endDate);
    //let startDate = getSixMonthsEarlier(endDate);
    const cutoffDate = dayjs('2001-01-01').toISOString();

    let allSegmetEfforts = [];

    while (dayjs(startDate).isAfter(cutoffDate)) {
        try {
            const response = await getStravaSegmenEffortsById(accessToken, segmentId, startDate, endDate);

            // Check for non-200 status code
            if (response.status !== 200) {
                console.log(`Iteration stopped due to non-200 response at endDate: ${endDate}`);
                break;
            }

            console.log(`SegmentId: ${segmentId}: ${startDate} - ${endDate} has ${response.data.length} segment efforts`)

            if( response.data.length > 0){
                allSegmetEfforts.push(...response.data);
            }
        } catch (error) {
            console.error(`Error fetching segment efforts: ${error.message}`);
            break;
        }

        // Move the date range back 6 months
        endDate = startDate;
        startDate = getFiveYearsEarlier(startDate);
    }
    return allSegmetEfforts;
}

module.exports = {
    convertGearIdToOCD,
    getStravaRecentRides,
    getStravaStarredSegments,
    getStravaSegmentById,
    getStravaSegmenEffortsById,
    getStravaActivityById,
    getStravaActivityStreamsById,
    getStravaAthleteDetail,
    getStravaSegmentEffortsForRider
};