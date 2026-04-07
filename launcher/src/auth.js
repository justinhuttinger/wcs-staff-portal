const { net } = require('electron')
const { API_URL } = require('./config')

let currentToken = null
let currentStaff = null
let cachedCredentials = {}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = API_URL + path
    const options = { method, url }

    const req = net.request(options)
    req.setHeader('Content-Type', 'application/json')
    if (currentToken) {
      req.setHeader('Authorization', 'Bearer ' + currentToken)
    }

    let responseData = ''
    req.on('response', (response) => {
      response.on('data', (chunk) => { responseData += chunk.toString() })
      response.on('end', () => {
        try {
          const data = JSON.parse(responseData)
          if (response.statusCode >= 400) {
            reject(new Error(data.error || 'Request failed'))
          } else {
            resolve(data)
          }
        } catch {
          reject(new Error('Invalid response'))
        }
      })
    })

    req.on('error', reject)

    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function login(email, password) {
  const data = await request('POST', '/auth/login', { email, password })
  currentToken = data.token
  currentStaff = data.staff
  return data
}

async function fetchCredentials(service) {
  const path = '/vault/credentials' + (service ? '?service=' + service : '')
  const data = await request('GET', path)
  for (const cred of data.credentials) {
    cachedCredentials[cred.service] = cred
  }
  return data.credentials
}

async function fetchAllCredentials() {
  const data = await request('GET', '/vault/credentials')
  cachedCredentials = {}
  for (const cred of data.credentials) {
    cachedCredentials[cred.service] = cred
  }
  return data.credentials
}

function getCachedCredential(service) {
  return cachedCredentials[service] || null
}

async function setToken(token) {
  currentToken = token
  // Fetch staff profile so we have the ID for vault operations
  try {
    const data = await request('GET', '/auth/me')
    currentStaff = data.staff
  } catch (err) {
    // Token might be invalid, but we still set it for other operations
  }
}
function getStaff() { return currentStaff }
function getToken() { return currentToken }
function isLoggedIn() { return !!currentToken }

function logout() {
  currentToken = null
  currentStaff = null
  cachedCredentials = {}
}

async function storeCredential(service, username, password) {
  const data = await request('POST', '/vault/credentials', {
    staff_id: currentStaff?.id,
    service,
    username,
    password,
  })
  cachedCredentials[service] = { service, username, password }
  return data
}

module.exports = {
  login, logout, isLoggedIn,
  setToken, getStaff, getToken,
  fetchCredentials, fetchAllCredentials, getCachedCredential,
  storeCredential,
}
