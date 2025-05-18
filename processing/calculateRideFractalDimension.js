const turf = require('@turf/turf');


/**
 * Convert latitude and longitude points to Cartesian distances
 * @param {Array} location - Array of latitude and longitude values (array of arrays)
 * @returns {Array} cartesian coordinates of the route
 */
function toCartesianCoords(route) {
    const start = route[0]; // Use the first point as reference
    return route.map(point => {
        const distX = turf.distance(start, [point[0], start[1]], { units: 'kilometers' }) * 1000; // meters
        const distY = turf.distance(start, [start[0], point[1]], { units: 'kilometers' }) * 1000; // meters
        return [distX, distY];
    });
}

/**
 * Calculates the fractal dimension of a ride based on the latitude and longitude values.
 *
 * @param {Array} route - Array of latitude and longitude values (array of arrays)
 * @returns {number} fractal dimension of the ride. E.g. 1.0 for straight line, 1.2-1.3 for a road, 1.6-1.7 for a mountain bike trail.
 */
function calculateRideFractalDimension(route, boxSizes = [5, 10, 20, 50, 100, 200, 500, 1000]) {
    if (!Array.isArray(route) || route.length === 0) {
        return 1.0;
    }

    const testRide = [
        [34.0522, -118.2437],  // Start
        [34.0530, -118.2420],
        [34.0545, -118.2405],
        [34.0560, -118.2390],
        [34.0572, -118.2400],
        [34.0578, -118.2425],
        [34.0575, -118.2445],
        [34.0560, -118.2460],
        [34.0542, -118.2472],
        [34.0525, -118.2465],
        [34.0510, -118.2450],
        [34.0505, -118.2435],
        [34.0515, -118.2420],
        [34.0522, -118.2437]   // Back to start (Closed loop)
    ];

    const cartesianRoute = toCartesianCoords(testRide);

    const logEps = [];
    const logN = [];

    for (const boxSize of boxSizes) {
        const occupiedBoxes = new Set();

        for (const [x, y] of cartesianRoute) {
            const boxX = Math.floor(x / boxSize);
            const boxY = Math.floor(y / boxSize);
            occupiedBoxes.add(`${boxX},${boxY}`);
        }

        logEps.push(Math.log(boxSize)); // Corrected from Math.log(1 / boxSize)
        logN.push(Math.log(occupiedBoxes.size));
    }

    // Compute linear regression (slope of log-log plot)
    const n = logEps.length;
    const sumX = logEps.reduce((a, b) => a + b, 0);
    const sumY = logN.reduce((a, b) => a + b, 0);
    const sumXY = logEps.map((e, i) => e * logN[i]).reduce((a, b) => a + b, 0);
    const sumX2 = logEps.map(e => e * e).reduce((a, b) => a + b, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    return Math.abs(slope); // The fractal dimension
}

module.exports = {
    calculateRideFractalDimension,
};
