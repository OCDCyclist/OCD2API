// Utility function to decompress an integer buffer
function decompressIntBuffer(compressedBuffer) {
    if( !Buffer.isBuffer(compressedBuffer)){
        return [];
    }
    const decompressedData = zlib.inflateSync(compressedBuffer); // Decompress
    const decompressedUint8Array = new Uint8Array(decompressedData); // Convert to Uint8Array

   // Convert to Uint16Array (Ensure proper alignment)
   if (decompressedUint8Array.length % 2 !== 0) {
     throw new Error('Decompressed byte length is not a multiple of 2');
   }

    const uInt16Array = new Uint16Array(decompressedUint8Array.buffer);
    return [...uInt16Array];
}

/**
 * Utility function to decompress a Float32Array buffer
 * @param {Buffer} compressedBuffer - The compressed buffer storing Float32Array data
 * @returns {number[]} - Decompressed array of floats
 */
function decompressFloatBuffer(compressedBuffer) {
    if (!Buffer.isBuffer(compressedBuffer)) {
        return [];
    }

    const decompressedData = zlib.inflateSync(compressedBuffer); // Decompress
    const decompressedUint8Array = new Uint8Array(decompressedData); // Convert to Uint8Array

    // Ensure proper alignment for Float32Array (4 bytes per float)
    if (decompressedUint8Array.length % 4 !== 0) {
        throw new Error('Decompressed byte length is not a multiple of 4');
    }

    const float32Array = new Float32Array(decompressedUint8Array.buffer);
    return [...float32Array];
}

module.exports = { decompressIntBuffer, decompressFloatBuffer };