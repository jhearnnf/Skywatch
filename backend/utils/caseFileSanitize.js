'use strict';

/**
 * caseFileSanitize.js
 *
 * Pure functions for stripping server-only scoring data from chapter objects
 * before they are sent to clients.
 * No DB, no model imports, no I/O.
 */

/**
 * Strip the `scoring` field from every stage in a chapter, and defensively
 * strip any top-level `scoring` field from the chapter itself.
 * Does NOT mutate the input object.
 *
 * @param {Object} chapter - plain chapter object with .stages[]
 * @returns {Object} sanitized shallow clone
 */
function sanitizeChapter(chapter) {
  if (!chapter || typeof chapter !== 'object') return chapter;

  // Shallow-clone the chapter, omitting any top-level `scoring` field.
  const { scoring: _topScoring, ...rest } = chapter;

  // Sanitize each stage — shallow-clone each, omitting `scoring`.
  const sanitizedStages = Array.isArray(chapter.stages)
    ? chapter.stages.map(stage => {
        const { scoring: _stageScoring, ...stageRest } = stage;
        return stageRest;
      })
    : chapter.stages;

  return { ...rest, stages: sanitizedStages };
}

/**
 * Return a minimal listing representation of a chapter, suitable for
 * menu / list endpoints.
 *
 * @param {Object} chapter
 * @returns {{ slug, chapterSlug, chapterNumber, title, dateRangeLabel, summary,
 *             estimatedMinutes, status, stageCount }}
 */
function sanitizeChapterForList(chapter) {
  if (!chapter || typeof chapter !== 'object') return chapter;

  return {
    slug:             chapter.slug,
    chapterSlug:      chapter.chapterSlug,
    chapterNumber:    chapter.chapterNumber,
    title:            chapter.title,
    dateRangeLabel:   chapter.dateRangeLabel,
    summary:          chapter.summary,
    estimatedMinutes: chapter.estimatedMinutes,
    status:           chapter.status,
    stageCount:       Array.isArray(chapter.stages) ? chapter.stages.length : chapter.stageCount,
  };
}

module.exports = { sanitizeChapter, sanitizeChapterForList };
