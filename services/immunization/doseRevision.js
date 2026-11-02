'use strict';
const {badRequest, conflict} = require('../../utils/AppError');

const assertRevision = (current, expectedRevision) => {
  if (!current && expectedRevision === null) return;
  if (!Number.isInteger(expectedRevision)) throw badRequest('Reload the saved dose before editing it.');
  if (!current || current.revision !== expectedRevision) throw conflict('This dose has changed. Reload before saving your changes.');
};

module.exports = {assertRevision};
