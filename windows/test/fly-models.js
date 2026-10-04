// fly-models.js — what each fly model's data hold, for the suites that run on
// all of them (test/run-models.mjs). Counts are read from each bundle's
// circuit; a changed ETL must change them here on purpose.
//   mixed:  FlyWire FAFB v783 brain, thermo/sensory extensions appended
//   male:   MaleCNS v1.0 brain, senses embedded by etl_malecns_brain.py
//   female: BANC v888 brain, senses embedded the same way
export const MODEL_EXPECTATIONS = {
  mixed: { auditory: 176, wind: 18, hot: 7, cold: 9, senses: 'attached' },
  male: { auditory: 25, wind: 250, hot: 7, cold: 7, senses: 'embedded' },
  female: { auditory: 90, wind: 35, hot: 6, cold: 6, senses: 'embedded' },
};

export function expectationsFor(data) {
  const model = data.provenance.flyModel || 'mixed';
  const expected = MODEL_EXPECTATIONS[model];
  if (!expected) throw new Error(`No test expectations for fly model ${model}`);
  return { model, ...expected };
}
