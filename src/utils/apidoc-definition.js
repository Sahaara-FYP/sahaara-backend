/**
 * @apiDefine RequestModel
 * @apiSuccess {Object} request The created request object.
 * @apiSuccess {String} request.id Unique ID of the request.
 * @apiSuccess {String} request.userId ID of the user who created the request.
 * @apiSuccess {String} request.title Title of the request.
 * @apiSuccess {String} [request.description] Detailed description of the request.
 * @apiSuccess {String} request.category Category of the request.
 * @apiSuccess {String="normal","high","low"} request.urgencyLevel Urgency level of the request.
 * @apiSuccess {String="pending","partially_accepted","accepted","completed","cancelled","expired"} request.status Current status of the request.
 * @apiSuccess {Number} request.locationLat Latitude of the request’s location.
 * @apiSuccess {Number} request.locationLng Longitude of the request’s location.
 * @apiSuccess {Boolean} request.postAnonymously Whether the request is posted anonymously.
 * @apiSuccess {Boolean} request.visibilityVerifiedOnly Whether only verified users can see the request.
 * @apiSuccess {Number} request.priorityScore Priority score used for sorting.
 * @apiSuccess {Boolean} request.visibilityWomenOnly Whether the request is visible to women only.
 * @apiSuccess {Number} request.reportedCount Number of times the request was reported.
 * @apiSuccess {String="clean","flagged","reviewed","blocked"} request.moderationStatus Moderation status of the request.
 * @apiSuccess {Number} request.responsesCount Number of responses to this request.
 * @apiSuccess {Number} request.maxHelpers Maximum number of helpers allowed.
 * @apiSuccess {Date} [request.completedAt] Timestamp when the request was completed.
 * @apiSuccess {Date} [request.expiresAt] Expiration timestamp of the request.
 * @apiSuccess {Object[]} [request.attachments] Optional attachments (JSON).
 * @apiSuccess {Date} request.createdAt Creation timestamp.
 * @apiSuccess {Date} request.updatedAt Last update timestamp.
 */

/**
 * @apiDefine RequestParticipatorModel
 * @apiSuccess {Object} participator The created request object.
 * @apiSuccess {String} participator.id Unique ID of the participator entry.
 * @apiSuccess {String} participator.requestId ID of the related request.
 * @apiSuccess {String} participator.userId ID of the user participating.
 * @apiSuccess {String="pending","accepted","rejected","withdrawn"} participator.status Participation status.
 * @apiSuccess {Date} participator.createdAt Creation timestamp.
 * @apiSuccess {Date} participator.updatedAt Last update timestamp.
 */
