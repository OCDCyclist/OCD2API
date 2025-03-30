

/**
 * Calculates the ride bounding box from a ride's location data.
 *
 * @param {Array} location - Array of latitude and longitude values (array of arrays)
 * @returns {Object} min, max, and center latitude and longitude values.
 */
function calculateRideBoundingBox(location) {
    if (!Array.isArray(location) || location.length === 0) {
        return Object.assign({}, {
            minlatitude: 0,
            minlongitude: 0,
            maxlatitude: 0,
            maxlongitude: 0,
            centerlatitude: 0,
            centerlongitude: 0,
        });
    }

    let minLatitude = Infinity;
    let maxLatitude = -Infinity;
    let minLongitude = Infinity;
    let maxLongitude = -Infinity;

    location.forEach(([latitude, longitude]) => {
        if (latitude < minLatitude) minLatitude = latitude;
        if (latitude > maxLatitude) maxLatitude = latitude;
        if (longitude < minLongitude) minLongitude = longitude;
        if (longitude > maxLongitude) maxLongitude = longitude;
    });

    const centerLatitude = (minLatitude + maxLatitude) / 2;
    const centerLongitude = (minLongitude + maxLongitude) / 2;

    return {
        minlatitude: minLatitude,
        minlongitude: minLongitude,
        maxlatitude: maxLatitude,
        maxlongitude: maxLongitude,
        centerlatitude: centerLatitude,
        centerlongitude: centerLongitude,
    };
}

module.exports = {
    calculateRideBoundingBox,
};
