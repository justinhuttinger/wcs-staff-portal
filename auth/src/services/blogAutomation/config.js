// auth/src/services/blogAutomation/config.js
// Static per-location SEO context + content categories for the blog generator.
// `key` MUST equal the media_assets.location string so photo search filters match.

const LOCATIONS = [
  {
    key: 'Salem', name: 'West Coast Strength Salem', city: 'Salem', wpCategory: 'Salem',
    keywords: ['gym in Salem Oregon', 'Salem fitness center', 'personal training Salem OR',
      'Salem gym membership', 'weight training Salem'],
    landmarks: ['Wallace Marine Park', 'Riverfront Park', 'Minto-Brown Island Park'],
    neighborhoods: ['West Salem', 'South Salem', 'Downtown Salem'],
    localContext: 'Salem is Oregon\'s capital, a family-oriented city in the Willamette Valley with strong parks and an active, community-minded population.',
    enabled: true,
  },
  {
    key: 'Keizer', name: 'West Coast Strength Keizer', city: 'Keizer', wpCategory: 'Keizer',
    keywords: ['gym in Keizer Oregon', 'Keizer fitness center', 'personal training Keizer OR',
      'Keizer gym membership', 'weight training Keizer'],
    landmarks: ['Keizer Station', 'Volcanoes Stadium', 'Keizer Rapids Park'],
    neighborhoods: ['Keizer', 'Clear Lake', 'Gubser'],
    localContext: 'Keizer is a tight-knit community just north of Salem, home to the Salem-Keizer Volcanoes, with strong community pride and an active outdoor culture.',
    enabled: true,
  },
  {
    key: 'Eugene', name: 'West Coast Strength Eugene', city: 'Eugene', wpCategory: 'Eugene',
    keywords: ['gym in Eugene Oregon', 'Eugene fitness center', 'personal training Eugene OR',
      'Eugene gym membership', 'weight training Eugene'],
    landmarks: ['University of Oregon', 'Pre\'s Trail', 'Alton Baker Park'],
    neighborhoods: ['South Eugene', 'Whiteaker', 'Cal Young'],
    localContext: 'Eugene is Track Town USA, home to the University of Oregon and a deep running culture, with a health-conscious population that values fitness and the outdoors.',
    enabled: true,
  },
  {
    key: 'Springfield', name: 'West Coast Strength Springfield', city: 'Springfield', wpCategory: 'Springfield',
    keywords: ['gym in Springfield Oregon', 'Springfield fitness center', 'personal training Springfield OR',
      'Springfield gym membership', 'weight training Springfield'],
    landmarks: ['McKenzie River', 'Dorris Ranch', 'Island Park'],
    neighborhoods: ['Thurston', 'Gateway', 'Downtown Springfield'],
    localContext: 'Springfield is Eugene\'s sister city, known for working-class roots and community spirit, with the McKenzie River nearby for world-class outdoor recreation.',
    enabled: true,
  },
  {
    key: 'Clackamas', name: 'West Coast Strength Clackamas', city: 'Clackamas', wpCategory: 'Clackamas',
    keywords: ['gym in Clackamas Oregon', 'Clackamas fitness center', 'personal training Clackamas OR',
      'Clackamas gym membership', 'weight training Clackamas'],
    landmarks: ['Clackamas Town Center', 'North Clackamas Park', 'Mt. Scott'],
    neighborhoods: ['Happy Valley', 'Sunnyside', 'Milwaukie'],
    localContext: 'Clackamas is part of the Portland metro area, offering suburban convenience with easy access to outdoor recreation along the Clackamas River and toward Mt. Hood.',
    enabled: true,
  },
  {
    key: 'Medford', name: 'West Coast Strength Medford', city: 'Medford', wpCategory: 'Medford',
    keywords: ['gym in Medford Oregon', 'Medford fitness center', 'personal training Medford OR',
      'Medford gym membership', 'weight training Medford'],
    landmarks: ['Bear Creek Greenway', 'Prescott Park', 'Roxy Ann Peak'],
    neighborhoods: ['East Medford', 'West Medford', 'Downtown Medford'],
    localContext: 'Medford is the hub of Southern Oregon\'s Rogue Valley, surrounded by wine country and outdoor recreation, with a warm climate and an active, growing population.',
    enabled: true,
  },
]

const CATEGORIES = [
  { key: 'fitness-tips', name: 'Fitness Tips', description: 'Workout guides, exercise tutorials, training advice',
    topics: ['Best compound exercises for building strength', 'How to properly warm up before lifting',
      'Progressive overload explained', 'Recovery tips for faster muscle repair',
      'How to break through a training plateau', 'A beginner\'s guide to strength training',
      'Why proper form matters more than weight', 'How to build a balanced weekly routine'] },
  { key: 'nutrition', name: 'Nutrition', description: 'Diet tips, meal planning, nutrition guidance',
    topics: ['What to eat before a workout', 'Post-workout meals for recovery',
      'How much protein you really need', 'Meal prep for busy schedules',
      'Understanding macros for your goals', 'Hydration and performance',
      'Healthy snacks that fuel training', 'Eating for fat loss without losing muscle'] },
  { key: 'local-fitness', name: 'Local Fitness', description: 'Local fitness culture, outdoor activities, seasonal content',
    topics: ['Best outdoor workout spots near [Location]', 'Staying fit through Oregon\'s rainy season',
      'Summer fitness challenges for [Location] residents', 'Keeping your routine through the holidays',
      'Spring into fitness: seasonal tips', 'Pairing gym training with [Location] outdoor activities'] },
  { key: 'gym-life', name: 'Gym Life', description: 'Equipment, gym culture, member tips',
    topics: ['Gym etiquette for a better experience', 'Making the most of your membership',
      'Group classes vs training solo', 'How to stay motivated at the gym',
      'Building a gym habit that sticks', 'How to use the most underrated equipment'] },
  { key: 'why-wcs', name: 'Why West Coast Strength', description: 'Location-specific benefits and community focus',
    topics: ['Why [Location] residents choose West Coast Strength', 'What makes our [Location] gym different',
      'The community at West Coast Strength [Location]', 'What to expect at WCS [Location]',
      'Personal training options at WCS [Location]'] },
]

const getLocation = (key) => LOCATIONS.find(l => l.key === key)
const enabledLocations = () => LOCATIONS.filter(l => l.enabled)

module.exports = { LOCATIONS, CATEGORIES, getLocation, enabledLocations }
