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
 *
 * `type` must match how the asset was uploaded: an authenticated asset does not
 * exist at the default 'upload' type, so destroying it without saying so is a
 * silent no-op that leaves the bytes on Cloudinary for ever.
 */
function destroyAsset(publicId, options = {}) {
  return cloudinary.uploader.destroy(publicId, options);
}

/**
 * A delivery URL for an asset uploaded with `type: 'authenticated'`.
 *
 * Authenticated assets are NOT reachable at their plain URL — the path has to
 * carry an `s--signature--` segment derived from the API secret. That is the
 * whole point of using the type for score sheets: unlike an ordinary upload,
 * where the URL is unguessable but permanently public to anyone who ever sees
 * it, an authenticated asset cannot be fetched at all without a URL we signed.
 *
 * No expiry is set. An expiring URL would have to be re-minted every time the
 * admin panel rendered a thumbnail, and the threat this is guarding against is
 * a URL leaking to a stranger, not an admin keeping one.
 */
function signedUrl(publicId, options = {}) {
  if (!publicId) return null;
  return cloudinary.url(publicId, {
    type: 'authenticated',
    resource_type: 'image',
    sign_url: true,
    secure: true,
    ...options,
  });
}

module.exports = { uploadBuffer, destroyAsset, signedUrl };
