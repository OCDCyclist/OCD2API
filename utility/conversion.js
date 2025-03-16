function convertCelsiusToFahrenheit(celsius) {
    return (celsius * 9/5) + 32;
}

function convertCelsiusToFahrenheit(celsius) {
    return (celsius * 9/5) + 32;
}

function convertMetersPerSecondToMilesPerHour(metersPerSecond) {
    const metersPerSecondToMph = 2.23694; // Conversion factor
    return metersPerSecond * metersPerSecondToMph;
}

function convertMetersToFeet(meters) {
    const metersToFeet = 3.28084; // Conversion factor
    return meters * metersToFeet;
}

function convertMetersToMiles(meters) {
    return meters * 0.000621371;
}

module.exports = { convertCelsiusToFahrenheit, convertCelsiusToFahrenheit, convertMetersPerSecondToMilesPerHour, convertMetersToFeet, convertMetersToMiles };