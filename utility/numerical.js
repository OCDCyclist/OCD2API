function roundValue(valueToRound, decimalPlaces) {
    const factor = Math.pow(10, decimalPlaces);
    const roundedValue =  Math.round(valueToRound * factor) / factor;
    return roundedValue;
}

module.exports = { roundValue };