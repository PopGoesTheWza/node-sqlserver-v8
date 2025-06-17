'use strict'

/* globals describe it */

const { TestEnv } = require('./env/test-env')
const env = new TestEnv()
const chai = require('chai')
const assert = chai.assert
const expect = chai.expect

// Enable trace-level logging for debugging test failures
const sql = require('../lib/sql')
const { configureTestLogging } = require('./common/logging-helper')

// Configure logging based on environment variables
// By default, tests run silently. To enable logging:
// - MSNODESQLV8_TEST_VERBOSE=true npm test  (for full trace logging)
// - MSNODESQLV8_TEST_LOG_LEVEL=DEBUG MSNODESQLV8_TEST_LOG_CONSOLE=true npm test
// - MSNODESQLV8_TEST_LOG_LEVEL=INFO MSNODESQLV8_TEST_LOG_FILE=/tmp/test.log npm test
configureTestLogging(sql)
const tablename = 'compoundqueries_table'
let testname = 'not set yet'
const driver = 'SQL Server Native Client 11.0'

describe('compoundqueries', function () {
  this.timeout(10000)

  this.beforeEach(async function () {
    sql.logger.info('Starting test setup', 'compoundqueries.test.beforeEach')
    await env.open()
    sql.logger.info('Test environment opened successfully', 'compoundqueries.test.beforeEach')
  })

  this.afterEach(async function () {
    sql.logger.info('Starting test cleanup', 'compoundqueries.test.afterEach')
    await env.close()
    sql.logger.info('Test environment closed successfully', 'compoundqueries.test.afterEach')
  })

  class Batcher {
    constructor () {
      this.received = []
    }

    send (cmd, expected, testDone) {
      const received = this.received

      const batch = cmd.join(';')
      this.q = env.theConnection.query(batch)
      const q = this.q
      q.on('error', e => {
        assert.ifError(e)
      })

      q.on('rowcount', count => {
        received.push(count)
        if (received.length === expected.length) {
          assert.deepStrictEqual(expected, received)
          testDone()
        }
      })
      return q
    }
  }

  it('check row count emission is as expected for compound queries 1 insert', testDone => {
    const cmd = [
      'create table rowsAffectedTest (id int, val int)',
      'insert into rowsAffectedTest values (1, 5)',
      'drop table rowsAffectedTest'
    ]
    const expected = [1]
    const batcher = new Batcher()
    batcher.send(cmd, expected, testDone)
  })

  testname = 'test 001 - batched query: SELECT....; INSERT ....; SELECT....;'
  it(testname, done => {
    const testcolumnsize = 100
    const testcolumntype = ' varchar(' + testcolumnsize + ')'
    const testcolumnclienttype = 'text'
    const testcolumnsqltype = 'varchar'
    const testcolumnname = 'col2'
    const testdata1 = null
    const testdata2Expected = 'string data row 2'
    const testdata2TsqlInsert = '\'' + testdata2Expected + '\''
    const tsql = `SELECT * FROM ${tablename} ORDER BY id;  INSERT INTO ${tablename} (${testcolumnname}) VALUES (${testdata1});SELECT * FROM ${tablename} ORDER BY id;`

    const expected1 = {
      meta: [
        { name: 'id', size: 10, nullable: false, type: 'number', sqlType: 'int identity' },
        {
          name: testcolumnname,
          size: testcolumnsize,
          nullable: true,
          type: testcolumnclienttype,
          sqlType: testcolumnsqltype
        }
      ],
      rows: [
        [1, null],
        [2, testdata2Expected]
      ]
    }

    const expected2 = {
      meta:
        null,
      rowcount:
        -1
    }

    const expected3 = {
      meta: [
        { name: 'id', size: 10, nullable: false, type: 'number', sqlType: 'int identity' },
        {
          name: testcolumnname,
          size: testcolumnsize,
          nullable: true,
          type: testcolumnclienttype,
          sqlType: testcolumnsqltype
        }
      ],
      rows: [[1, null],
        [2, testdata2Expected],
        [3, null]]
    }

    const fns =
      [
        asyncDone => {
          env.commonTestFns.createTable(env.theConnection, tablename, testcolumnname, testcolumntype, () => {
            asyncDone()
          })
        },
        asyncDone => {
          env.commonTestFns.insertDataTSQL(env.theConnection, tablename, testcolumnname, testdata1, () => {
            asyncDone()
          })
        },
        asyncDone => {
          env.commonTestFns.insertDataTSQL(env.theConnection, tablename, testcolumnname, testdata2TsqlInsert, () => {
            asyncDone()
          })
        },
        asyncDone => {
          env.commonTestFns.compoundQueryTSQL(env.theConnection, tsql, expected1, expected2, expected3, testname, () => {
            asyncDone()
          })
        }
      ]

    env.async.series(fns, () => {
      done()
    }) // end of async.series()
  }) // end of it()

  it('check row count emission is as expected for compound queries 3 inserts, update all', testDone => {
    const expected = [1, 1, 1, 3]

    const cmd = [
      'create table rowsAffectedTest (id int)',
      'insert into rowsAffectedTest values (1)',
      'insert into rowsAffectedTest values (1)',
      'insert into rowsAffectedTest values (1)',
      'update rowsAffectedTest set id = 1',
      'drop table rowsAffectedTest'
    ]
    const batcher = new Batcher()
    batcher.send(cmd, expected, testDone)
  })

  it('check row count emission is as expected for compound queries 4 inserts, 2 updates, 2 updates, update all', testDone => {
    const expected = [1, 1, 1, 1, 2, 2, 4]

    const cmd = [
      'create table rowsAffectedTest (id int, val int)',
      'insert into rowsAffectedTest values (1, 5)',
      'insert into rowsAffectedTest values (2, 10)',
      'insert into rowsAffectedTest values (3, 20)',
      'insert into rowsAffectedTest values (4, 30)',

      'update rowsAffectedTest set val = 100  where id in (1, 2)',
      'update rowsAffectedTest set val = 100  where id in (3, 4)',
      'update rowsAffectedTest set val = 100  where id in (1, 2, 3, 4)',

      'drop table rowsAffectedTest'
    ]

    const batcher = new Batcher()
    batcher.send(cmd, expected, testDone)
  })

  /*
  testname = 'test 002 - batched query: SELECT....; PRINT ....; SELECT....;'
  it(testname, function (done) {
    var testcolumnsize = 100
    var testcolumntype = ' varchar(' + testcolumnsize + ')'
    var testcolumnclienttype = 'text'
    var testcolumnsqltype = 'varchar'
    var testcolumnname = 'col2'
    var testdata1 = null
    var testdata2Expected = 'string data row 2'
    var testdata2TsqlInsert = '\'' + testdata2Expected + '\''
    var tsql = 'SELECT * FROM ' + tablename + ' ORDER BY id;  PRINT \'hello B.O.B.\';SELECT * FROM ' + tablename + ' ORDER BY id;'

    var expected1 = {
      meta: [
        {name: 'id', size: 10, nullable: false, type: 'number', sqlType: 'int identity'},
        {
          name: testcolumnname,
          size: testcolumnsize,
          nullable: true,
          type: testcolumnclienttype,
          sqlType: testcolumnsqltype
        }
      ],
      rows: [
        [1, null],
        [2, testdata2Expected]
      ]
    }

    var expected2 = {
      meta:
        null,
      rowcount:
        -1
    }

    var fns = [
      function (asyncDone) {
        env.commonTestFns.createTable(env.theConnection, tablename, testcolumnname, testcolumntype, function () {
          asyncDone()
        })
      },
      function (asyncDone) {
        env.commonTestFns.insertDataTSQL(env.theConnection, tablename, testcolumnname, testdata1, function () {
          asyncDone()
        })
      },
      function (asyncDone) {
        env.commonTestFns.insertDataTSQL(env.theConnection, tablename, testcolumnname, testdata2TsqlInsert, function () {
          asyncDone()
        })
      },
      function (asyncDone) {
        env.commonTestFns.compoundQueryTSQL(env.theConnection, tsql, expected1, expected2, expected1, testname, function () {
          asyncDone()
        })
      }
    ]

    async.series(fns, function () {
      done()
    })  // end of async.series()
  }) // end of it()
*/

  testname = 'test 003 - batched query: SELECT....; SELECT (with no results) ....; SELECT....;'
  it(testname, done => {
    const testcolumnsize = 100
    const testcolumntype = ` varchar(${testcolumnsize})`
    const testcolumnclienttype = 'text'
    const testcolumnsqltype = 'varchar'
    const testcolumnname = 'col2'
    const testdata1 = null
    const testdata2Expected = 'string data row 2'
    const testdata2TsqlInsert = `'${testdata2Expected}'`
    const tsql = `SELECT * FROM ${tablename} ORDER BY id;  SELECT * FROM ${tablename} WHERE 1=2; SELECT * FROM ${tablename} ORDER BY id;`

    const expected1 = {
      meta: [
        { name: 'id', size: 10, nullable: false, type: 'number', sqlType: 'int identity' },
        {
          name: testcolumnname,
          size: testcolumnsize,
          nullable: true,
          type: testcolumnclienttype,
          sqlType: testcolumnsqltype
        }
      ],
      rows: [
        [1, null],
        [2, testdata2Expected]
      ]
    }

    const expected2 = {
      meta: [
        { name: 'id', size: 10, nullable: false, type: 'number', sqlType: 'int identity' },
        {
          name: testcolumnname,
          size: testcolumnsize,
          nullable: true,
          type: testcolumnclienttype,
          sqlType: testcolumnsqltype
        }
      ],
      rows:
        []
    }

    const fns = [

      asyncDone => {
        env.commonTestFns.createTable(env.theConnection, tablename, testcolumnname, testcolumntype, () => {
          asyncDone()
        })
      },
      asyncDone => {
        env.commonTestFns.insertDataTSQL(env.theConnection, tablename, testcolumnname, testdata1, () => {
          asyncDone()
        })
      },
      asyncDone => {
        env.commonTestFns.insertDataTSQL(env.theConnection, tablename, testcolumnname, testdata2TsqlInsert, () => {
          asyncDone()
        })
      },
      asyncDone => {
        env.commonTestFns.compoundQueryTSQL(env.theConnection, tsql, expected1, expected2, expected1, testname, () => {
          asyncDone()
        })
      }
    ]

    env.async.series(fns, () => {
      done()
    }) // end of async.series()
  }) // end of it()

  testname = 'test 004 - batched query: SELECT....; INSERT (invalid...should fail) ....; SELECT....;'
  it(testname, done => {
    const invalidtablename = `invalid${tablename}`
    const testcolumnsize = 100
    const testcolumntype = ` varchar(${testcolumnsize})`
    const testcolumnname = 'col2'
    const testdata1 = null
    const testdata2Expected = 'string data row 2'
    const testdata2TsqlInsert = `'${testdata2Expected}'`
    const tsql = `SELECT * FROM ${tablename} ORDER BY id;  INSERT INTO ${invalidtablename} (${testcolumnname}) VALUES (${testdata1});SELECT * FROM ${tablename} ORDER BY id;`

    const expectedError = new Error('[Microsoft][' + driver + '][SQL Server]Invalid object name \'' + invalidtablename + '\'.')
    expectedError.sqlstate = '42S02'
    expectedError.code = 208

    const fns =
      [
        asyncDone => {
          env.commonTestFns.createTable(env.theConnection, tablename, testcolumnname, testcolumntype, () => {
            asyncDone()
          })
        },
        asyncDone => {
          env.commonTestFns.insertDataTSQL(env.theConnection, tablename, testcolumnname, testdata1, () => {
            asyncDone()
          })
        },
        asyncDone => {
          env.commonTestFns.insertDataTSQL(env.theConnection, tablename, testcolumnname, testdata2TsqlInsert, () => {
            asyncDone()
          })
        },
        asyncDone => {
          env.commonTestFns.invalidQueryTSQL(env.theConnection, tsql, expectedError, testname, () => {
            asyncDone()
          })
        }
      ]

    env.async.series(fns, () => {
      done()
    }) // end of async.series()
  }) // end of it()
})
