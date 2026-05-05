// Single source of truth for the 7 WCS locations and their per-club
// ABC Financial workstation URLs. Used by the in-app location picker
// at first launch. The Windows NSIS installer (installer.nsh) keeps
// its own copy of this data because it has to write config.json
// before the launcher first runs — keep the two in sync when adding
// or changing a location.

const LOCATIONS = [
  { name: 'Salem',       abc_url: 'https://prod02.abcfinancial.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=9a84c8e908a74fc494d114a36a48c969&wizardFirstLoad=1' },
  { name: 'Keizer',      abc_url: 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=cff423f895d340888d67812e4ee2409f&wizardFirstLoad=1' },
  { name: 'Eugene',      abc_url: 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=e3eae001c08148038497e1379344f0e0&wizardFirstLoad=1' },
  { name: 'Springfield', abc_url: 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=310aa987194d4e4295aff333c6e69df9&wizardFirstLoad=1' },
  { name: 'Clackamas',   abc_url: 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=4bab4e83fd394d5d81970af7b88e4426&wizardFirstLoad=1' },
  { name: 'Milwaukie',   abc_url: 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=da82fd71e8ac4edb989e11207a92ec8d&wizardFirstLoad=1' },
  { name: 'Medford',     abc_url: 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=87c18f3a76c4400198c951d50d5d94a4&wizardFirstLoad=1' },
]

function getAbcUrlFor(locationName) {
  const match = LOCATIONS.find(l => l.name.toLowerCase() === String(locationName || '').toLowerCase())
  return match ? match.abc_url : ''
}

module.exports = { LOCATIONS, getAbcUrlFor }
