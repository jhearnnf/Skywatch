const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a Buffer to Cloudinary.
 * @param {Buffer} buffer
 * @param {object} options - passed to upload_stream (folder, public_id, etc.)
 * @returns {Promise<{secure_url: string, public_id: string}>}
 */
function uploadBuffer(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'brief-images', resource_type: 'image', ...options },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(buffer);
  });
}

/**
 * Delete a Cloudinary asset by its public_id.
 */
function destroyAsset(publicId) {
  return cloudinary.uploader.destroy(publicId);
}

module.exports = { uploadBuffer, destroyAsset };
