const supabase = require('./supabase');

async function upsertPipelines(pipelines, locationId) {
  let pipelinesUpserted = 0;
  let stagesUpserted = 0;
  const errors = [];

  for (const pipeline of pipelines) {
    const pipelineRow = {
      id: pipeline.id,
      location_id: locationId,
      name: pipeline.name,
      synced_at: new Date().toISOString(),
    };

    const { error: pError } = await supabase
      .from('ghl_pipelines')
      .upsert(pipelineRow, { onConflict: 'id' });

    if (pError) {
      errors.push({ pipeline: pipeline.id, error: pError.message });
      continue;
    }
    pipelinesUpserted++;

    if (pipeline.stages.length > 0) {
      const stageRows = pipeline.stages.map(s => ({
        id: s.id,
        pipeline_id: pipeline.id,
        name: s.name,
        position: s.position,
        synced_at: new Date().toISOString(),
      }));

      const { error: sError, count } = await supabase
        .from('ghl_pipeline_stages')
        .upsert(stageRows, { onConflict: 'id', count: 'exact' });

      if (sError) {
        errors.push({ pipeline: pipeline.id, stagesError: sError.message });
      } else {
        stagesUpserted += count || stageRows.length;
      }
    }
  }

  return { pipelinesUpserted, stagesUpserted, errors };
}

module.exports = { upsertPipelines };
