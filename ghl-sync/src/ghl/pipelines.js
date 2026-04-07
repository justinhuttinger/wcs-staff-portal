const { get } = require('./client');

async function fetchPipelines(locationId) {
  const data = await get('/opportunities/pipelines', { locationId });
  const pipelines = data.pipelines || [];

  return pipelines.map(p => ({
    id: p.id,
    name: p.name,
    stages: (p.stages || []).map(s => ({
      id: s.id,
      name: s.name,
      position: s.position || 0,
    })),
  }));
}

module.exports = { fetchPipelines };
