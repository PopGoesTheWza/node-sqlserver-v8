
const { TestEnv } = require('../../test/env/test-env')
const env = new TestEnv()

const connectionString = env.connectionString
console.log(`connectionString = ${connectionString}`)

const isolation = 'SNAPSHOT'

async function run (id) {
  const conn = await env.sql.promises.open(connectionString)
  await conn.promises.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`)
  iterate(id, conn)
}

let counter = 0
async function iterate (id, conn) {
  console.log(`start [${id}] counter = ${counter}`)
  try {
    await conn.promises.query('BEGIN TRANSACTION')
    await conn.promises.query('INSERT INTO _customer (name) OUTPUT INSERTED.id,INSERTED.name VALUES (?)', ['foo'])
    await conn.promises.query('select top 10 * from _customer order by id DESC')
    await conn.promises.query('COMMIT')
  } catch (e) {
    console.log(`[${id}] error = ${e}`)
  }
  console.log(`done [${id}] counter = ${counter}`)

  setTimeout(() => {
    ++counter
    iterate(id, conn)
  }, 100)
}

for (let i = 0; i < 10; i++) {
  run(i)
}
