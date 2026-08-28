const test = require('node:test')
const assert = require('node:assert/strict')

const supaPath = require.resolve('../src/services/supabase')

function withEmployees(rows, run) {
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true,
    exports: {
      supabaseAdmin: {
        from: () => ({
          select: () => ({
            eq: async () => (rows instanceof Error
              ? { data: null, error: { message: rows.message } }
              : { data: rows, error: null }),
          }),
        }),
      },
    },
  }
  delete require.cache[require.resolve('../src/lib/resolveEmployeeId')]
  const mod = require('../src/lib/resolveEmployeeId')
  return run(mod)
}

const CLUB = '30935'
const baley = { employee_id: 'emp-baley', full_name: 'Baley Houldson', status: 'active' }

test('a name resolves to the employee id', async () => {
  await withEmployees([baley], async ({ resolveEmployeeId }) => {
    assert.equal(await resolveEmployeeId(CLUB, 'Baley Houldson'), 'emp-baley')
  })
})

test('spacing and case do not make a second person', async () => {
  await withEmployees([baley], async ({ resolveEmployeeId }) => {
    assert.equal(await resolveEmployeeId(CLUB, '  baley   houldson '), 'emp-baley')
  })
})

test('falls back to first and last when there is no full_name', async () => {
  await withEmployees(
    [{ employee_id: 'emp-2', first_name: 'Jane', last_name: 'Doe', status: 'active' }],
    async ({ resolveEmployeeId }) => {
      assert.equal(await resolveEmployeeId(CLUB, 'Jane Doe'), 'emp-2')
    }
  )
})

test('an active staffer beats a departed namesake', async () => {
  await withEmployees([
    { employee_id: 'emp-old', full_name: 'Chris Miller', status: 'terminated' },
    { employee_id: 'emp-now', full_name: 'Chris Miller', status: 'Active' },
  ], async ({ resolveEmployeeId }) => {
    assert.equal(await resolveEmployeeId(CLUB, 'Chris Miller'), 'emp-now')
  })
})

test('two active people with one name stay unresolved rather than guessed', async () => {
  await withEmployees([
    { employee_id: 'emp-a', full_name: 'Chris Miller', status: 'active' },
    { employee_id: 'emp-b', full_name: 'Chris Miller', status: 'active' },
  ], async ({ resolveEmployeeId }) => {
    // Crediting the wrong one, silently, is worse than recording the name alone.
    assert.equal(await resolveEmployeeId(CLUB, 'Chris Miller'), null)
  })
})

test('an unknown name is null, not an error', async () => {
  await withEmployees([baley], async ({ resolveEmployeeId }) => {
    assert.equal(await resolveEmployeeId(CLUB, 'Nobody At All'), null)
  })
})

test('a blank name or missing club never queries', async () => {
  await withEmployees([baley], async ({ resolveEmployeeId }) => {
    assert.equal(await resolveEmployeeId(CLUB, '   '), null)
    assert.equal(await resolveEmployeeId(null, 'Baley Houldson'), null)
  })
})

test('a database failure returns null rather than throwing into a tour save', async () => {
  await withEmployees(new Error('connection reset'), async ({ resolveEmployeeId }) => {
    assert.equal(await resolveEmployeeId(CLUB, 'Baley Houldson'), null)
  })
})

test('the map is built in one read for the whole roster', async () => {
  await withEmployees([
    baley,
    { employee_id: 'emp-2', full_name: 'Jane Doe', status: 'active' },
  ], async ({ employeeIdMap }) => {
    const m = await employeeIdMap(CLUB)
    assert.equal(m.size, 2)
    assert.equal(m.get('baley houldson'), 'emp-baley')
    assert.equal(m.get('jane doe'), 'emp-2')
  })
})
