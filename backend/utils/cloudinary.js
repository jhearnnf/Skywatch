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

/**
 * Signed parameters for a browser to upload ONE file straight to Cloudinary.
 *
 * Every parameter that decides where the file lands and what is kept of it is
 * part of the signature, so the client can change none of them: not the
 * public id (which pins the conversation folder), not the `authenticated`
 * type, and not the incoming transformation that shrinks the file before it
 * is stored. Cloudinary rejects the upload if any of them differ.
 *
 * @returns {{ uploadUrl, fields }} POST `fields` plus the file as multipart to `uploadUrl`
 */
function signDirectUpload({ publicId, resourceType, transformation, format }) {
  const timestamp = Math.round(Date.now() / 1000);
  const params = {
    public_id: publicId,
    timestamp,
    type: 'authenticated',
    ...(transformation ? { transformation } : {}),
    ...(format ? { format } : {}),
  };
  const signature = cloudinary.utils.api_sign_request(params, process.env.CLOUDINARY_API_SECRET);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    fields: { ...params, api_key: process.env.CLOUDINARY_API_KEY, signature },
  };
}

/**
 * True when an upload response really came from Cloudinary for this asset.
 * The response carries a signature over public_id + version made with our API
 * secret, so a client cannot claim an upload it never made.
 */
function verifyUploadResponse({ publicId, version, signature }) {
  if (!publicId || !version || !signature) return false;
  try {
    return cloudinary.utils.verify_api_response_signature(publicId, version, signature);
  } catch {
    return false;
  }
}

/**
 * Signed delivery URL for an authenticated video, or a still frame from one
 * (`format: 'jpg'`). The video sibling of signedUrl().
 */
function signedVideoUrl(publicId, options = {}) {
  if (!publicId) return null;
  return cloudinary.url(publicId, {
    type: 'authenticated',
    resource_type: 'video',
    sign_url: true,
    secure: true,
    ...options,
  });
}

/** Account usage (storage, bandwidth, credits) for the admin readout. */
function accountUsage() {
  return cloudinary.api.usage();
}

module.exports = {
  uploadBuffer, destroyAsset, signedUrl,
  signDirectUpload, verifyUploadResponse, signedVideoUrl, accountUsage,
};
