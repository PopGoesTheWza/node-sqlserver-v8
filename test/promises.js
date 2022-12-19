/* eslint-disable no-unused-expressions */
'use strict'

/* globals describe it */

const { TestEnv } = require('./env/test-env')
const env = new TestEnv()
const chai = require('chai')
const assert = chai.assert
const expect = chai.expect
chai.use(require('chai-as-promised'))

describe('promises', function () {
  this.timeout(30000)

  this.beforeEach(done => {
    env.open().then(() => done())
  })

  this.afterEach(done => {
    env.close().then(() => done())
  })

  it('select promise query with no column name', async function handler () {
    const r1 = await env.theConnection.promises.query('select 1,2 union select 3,4', [],
      { replaceEmptyColumnNames: true })
    // console.log(JSON.stringify(r1.first, null, 0))
    expect(r1.first[0].Column0).is.equal(1)
    expect(r1.first[0].Column1).is.equal(2)
    expect(r1.first[1].Column0).is.equal(3)
    expect(r1.first[1].Column1).is.equal(4)
  })

  function procDef (spName) {
    return {
      name: spName,
      sql: `create PROCEDURE ${spName} @param VARCHAR(50) 
          AS 
          BEGIN 
           RETURN LEN(@param); 
          END 
          `
    }
  }

  async function createProc (spName) {
    spName = spName || 'sp_test'
    const def = procDef(spName)
    const proc = env.procTest(def)
    await proc.create()
  }

  it('adhoc proc promise on sql: open call close', async function handler () {
    const spName = 'sp_test'
    await createProc(spName)
    const msg = 'hello world'
    const res = await env.sql.promises.callProc(env.connectionString, spName, {
      param: msg
    })
    assert(res !== null)
    assert(res.output !== null)
    assert.deepStrictEqual(res.output[0], msg.length)
  })

  it('get proc and call promises', async function handler () {
    const spName = 'sp_test'
    await createProc(spName)
    const msg = 'hello world'
    const proc = await env.theConnection.promises.getProc(spName)
    const res = await proc.promises.call({
      param: msg
    })
    assert(res !== null)
    assert(res.output !== null)
    assert.deepStrictEqual(res.output[0], msg.length)
  })

  it('promises for table insert select rows', async function handler () {
    const bulkTableDef = {
      tableName: 'test_table_bulk',
      columns: [
        {
          name: 'id',
          type: 'INT PRIMARY KEY'
        },
        {
          name: 'd1',
          type: 'datetime'
        },
        {
          name: 's1',
          type: 'VARCHAR (255) NOT NULL'
        },
        {
          name: 's2',
          type: 'VARCHAR (100) NOT NULL'
        },
        {
          name: 's3',
          type: 'VARCHAR (50) NOT NULL'
        },
        {
          name: 's4',
          type: 'VARCHAR (50) NOT NULL'
        }
      ]
    }

    const helper = env.bulkTableTest(bulkTableDef)
    const testDate = new Date('Mon Apr 26 2021 22:05:38 GMT-0500 (Central Daylight Time)')
    const expected = []
    const rows = 3000
    for (let i = 0; i < rows; ++i) {
      expected.push({
        id: i,
        d1: testDate,
        s1: `${i}`,
        s2: `testing${i + 1}2Data`,
        s3: `testing${i + 2}2Data`,
        s4: `testing${i + 3}2Data`
      })
    }
    env.theConnection.setUseUTC(true)
    const table = await helper.create()
    await table.promises.insert(expected)
    const res = await table.promises.select(expected)
    res.forEach(a => {
      delete a.d1.nanosecondsDelta
    })
    expect(res).to.deep.equal(expected)
  })

  it('using promises to open, query, close pool', async function handler () {
    const size = 4
    const pool = new env.sql.Pool({
      connectionString: env.connectionString,
      ceiling: size
    })
    await pool.promises.open()
    const all = Array(size * 2).fill(0).map((_, i) => pool.promises.query(`select ${i} as i, @@SPID as spid`))
    const promised = await Promise.all(all)
    const res = promised.map(r => r.first[0].spid)
    assert(res !== null)
    const set = new Set(res)
    expect(set.size).to.equal(size)
    await pool.promises.close()
  })

  it('adhoc promise: open select close', async function handler () {
    const res = await env.sql.promises.query(env.connectionString, 'select @@SPID as spid')
    assert(res !== null)
    assert(res.first !== null)
    expect(res.first[0]).has.property('spid')
  })

  it('query aggregator: insert 1 valid 1, ivalid table', async function handler () {
    const tableName = 'rowsAffectedTest'
    try {
      const sql = `if exists(select * from information_schema.tables
          where table_name = '${tableName}' and TABLE_SCHEMA='dbo')
              drop table ${tableName};
       create table ${tableName} (id int, val int);
       
       insert into ${tableName} values (1, 5);
       insert into ${tableName} values (2, 10);
       insert into ${tableName} values (3, 20);
       insert into ${tableName} values (4, 30);

       select x from ${tableName};`

      await env.theConnection.promises.query(sql)
      return new Error('expecting error')
    } catch (e) {
      // we lose 1 count from driver
      const res = e._results
      assert(res !== null)
      assert(res.meta !== null)
      expect(res.errors.length).to.equal(1)

      expect(res.meta).to.be.an('array').that.is.empty
      expect(res.results).to.be.an('array').that.is.empty

      // assert.deepStrictEqual(res.counts, expectedCounts)
      return null
    }
  })

  it('query aggregator: drop, create, insert, select, drop', async function handler () {
    const tableName = 'rowsAffectedTest'
    const m1 = `create table ${tableName}`
    const m2 = `insert table ${tableName}`
    const m3 = `select table ${tableName}`
    const m4 = `drop table ${tableName}`
    const sql = `if exists(select * from information_schema.tables
            where table_name = '${tableName}' and TABLE_SCHEMA='dbo')
                drop table ${tableName};
            print('${m1}');
            create table ${tableName} (id int, val int);
            print('${m2}');
            insert into ${tableName} values (1, 5);
            print('${m3}');
            select * from ${tableName};
            print('${m4}');
            drop table ${tableName};`

    const res = await env.theConnection.promises.query(sql)
    assert(res !== null)
    assert(res.meta !== null)
    assert.deepStrictEqual(res.meta.length, 1)
    const meta0 = res.meta[0]
    assert.deepStrictEqual(meta0[0].name, 'id')
    assert.deepStrictEqual(meta0[1].name, 'val')

    const expectedMessages = [m1, m2, m3, m4]
    assert.deepStrictEqual(res.info.length, 4)
    assert.deepStrictEqual(res.info, expectedMessages)

    assert(res.first !== null)
    assert.deepStrictEqual(res.results.length, 1)
    assert.deepStrictEqual(res.first, [{
      id: 1,
      val: 5
    }])
  })

  it('query aggregator: 4 inserts, 2 updates, 2 updates, update all', async function handler () {
    const tableName = 'rowsAffectedTest'
    const sql = `if exists(select * from information_schema.tables
          where table_name = '${tableName}' and TABLE_SCHEMA='dbo')
              drop table ${tableName};
       create table ${tableName} (id int, val int);
       insert into ${tableName} values (1, 5);
       insert into ${tableName} values (2, 10);
       insert into ${tableName} values (3, 20);
       insert into ${tableName} values (4, 30);

       update ${tableName} set val = 100  where id in (1, 2);
       update ${tableName} set val = 100  where id in (3, 4);
       update ${tableName} set val = 100  where id in (1, 2, 3, 4);

       drop table ${tableName};`
    const expectedCounts = [1, 1, 1, 1, 2, 2, 4]
    const res = await env.theConnection.promises.query(sql)
    assert(res !== null)
    assert(res.meta !== null)
    assert.deepStrictEqual(res.meta, [])
    assert.deepStrictEqual(res.results, [])
    assert.deepStrictEqual(res.counts, expectedCounts)
  })

  it('query aggregator: insert into invalid table', async function handler () {
    async function f0 () {
      const tableName = 'invalidTable'
      const sql = `insert into ${tableName} values (1, 5);`
      await env.theConnection.promises.query(sql)
    }
    await expect(f0()).to.be.rejectedWith('Invalid object name \'invalidTable\'')
  })

  it('query aggregator: query dead connection - expect error', async function handler () {
    async function f0 () {
      const proxy = await env.connection()
      await proxy.promises.close()
      await proxy.query('select @@SPID as spid')
    }
    await expect(f0()).to.be.rejectedWith('closed')
  })

  it('query aggregator: query dead pool - expect error', async function handler () {
    async function f0 () {
      const proxy = await env.pool()
      await proxy.promises.open()
      await proxy.promises.close()
      await proxy.promises.query('select @@SPID as spid')
    }
    await expect(f0()).to.be.rejectedWith('closed')
  })
})
