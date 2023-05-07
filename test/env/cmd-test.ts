import {
  ProcedureSummary,
  SqlClient,
  Connection,
  ProcedureManager,
  PreparedStatement,
  QueryCb
} from 'msnodesqlv8/types'

const sql: SqlClient = require('msnodesqlv8')
const { TestEnv } = require('../../../test/env/test-env')
const argv: Options = require('minimist')(process.argv.slice(2))
const assert = require('assert')

const env = new TestEnv()

interface Options {
  t: string
  top?: number
  columns?: string
  schema?: string
  table?: string
  severity?: number
  delay?: number
  repeats?: number
  iterations?: number
  stream?: boolean
  prepared?: boolean
}

export interface SimpleTest {
  run: (connectString: string, argv: Options) => void
}

const getConnectionsSql: string = `SELECT 
DB_NAME(dbid) as DBName,
    COUNT(dbid) as NumberOfConnections,
    loginame as LoginName
FROM
sys.sysprocesses
WHERE
dbid > 0
and DB_NAME(dbid) = 'scratch'
GROUP BY
dbid, loginame`

class PrintConnection implements SimpleTest {
  public test (connectString: string, conn: Connection, done: Function): void {
    conn.query('select @@SPID as id, CURRENT_USER as name', (err: Error, res: any[]) => {
      if (err != null) {
        throw err
      }
      res = res == null ? [] : res
      const sp = res[0].id
      console.log(`open[${sp}]:  ${connectString}`)
      conn.query(getConnectionsSql, (err: Error, res: any[]) => {
        if (err != null) {
          throw err
        }
        const count = res[0].NumberOfConnections
        conn.close(() => {
          console.log(`close[${sp}]: NumberOfConnections = ${count}`)
          done()
        })
      })
    })
  }

  public run (connectString: string, argv: Options): void {
    const delay: number = argv.delay == null ? 5000 : argv.delay
    const repeats: number = argv.repeats == null ? 10 : argv.repeats
    console.log(`${connectString}`)
    let iteration = 0
    const repeatId = setInterval(() => {
      sql.promises.open(connectString).then((conn) => {
        this.test(connectString, conn, () => {
          ++iteration
          if (iteration === repeats) {
            clearInterval(repeatId)
          }
        })
      }).catch(e => {
        console.error(e)
      })
    }, delay)
  }
}

class Benchmark implements SimpleTest {
  public run (connectString: string, argv: Options): void {
    const delay: number = argv.delay == null ? 500 : argv.delay
    const repeats: number = argv.repeats == null ? 10 : argv.repeats
    const prepared: boolean = argv.prepared == null ? false : argv.prepared
    const stream: boolean = argv.stream == null ? false : argv.stream
    const table: string = argv.table == null ? 'syscomments' : argv.table
    const schema: string = argv.schema == null ? 'master.' : argv.schema
    const columns: string = argv.columns == null ? '*' : argv.columns
    const top: number = argv.top == null ? -1 : argv.top
    const query = top < 0
      ? `select ${columns} from ${schema}.${table}`
      : `select top ${top} ${columns} from ${schema}.${table}`
    console.log(`Benchmark query ${query}`)
    let runs = 0
    let total = 0
    let statement: PreparedStatement
    function getReady (done: Function): void {
      sql.promises.open(connectString).then(conn => {
        if (prepared) {
          console.log(`preparing query ${query}`)
          conn.prepare(query, function (err, state: PreparedStatement) {
            const cols = state.getMeta().map(x => x.name).join()
            console.log(cols)
            done(err, conn, state)
          })
        } else {
          done(null, conn, null)
        }
      }).catch(err => {
        done(err, null, null)
      })
    }

    function getData (conn: Connection, cb: QueryCb): void {
      const rows: any[] = []
      if (prepared) {
        if (stream) {
          const q = statement.preparedQuery([])
          q.on('done', () => {
            cb(undefined, rows)
          })
          q.on('row', () => {
            rows[rows.length] = []
          })
        } else {
          statement.preparedQuery([], cb)
        }
      } else {
        if (stream) {
          const q = conn.query(query)
          q.on('done', () => {
            cb(undefined, rows)
          })
          q.on('row', () => {
            rows[rows.length] = []
          })
        } else {
          conn.query(query, cb)
        }
      }
    }

    getReady((err: Error, conn: Connection, ps: PreparedStatement) => {
      if (err != null) {
        console.log(err)
        throw err
      }
      let repeatId: any = null
      function once (d: Date, err: any, rows: any): void {
        if (err != null) {
          console.log(err.message)
          throw err
        }

        const elapsed = new Date().getTime() - d.getTime()
        ++runs
        total += elapsed
        console.log(`[${table}\t] rows.length ${rows.length} \t elapsed ${elapsed}\t ms [ runs ${runs} avg ${total / runs} ]`)
        if (runs === repeats) {
          clearInterval(repeatId)
          if (prepared) {
            statement.free(function () {
            })
          }
        }
      }

      statement = ps

      repeatId = setInterval(() => {
        let d = new Date()
        if (stream) {
          getData(conn, (err, rows) => {
            once(d, err, rows)
          })
        } else {
          getData(conn, (err, rows) => {
            once(d, err, rows)
            d = new Date()
            getData(conn, (err, rows) => {
              once(d, err, rows)
              d = new Date()
              getData(conn, (err, rows) => {
                once(d, err, rows)
              })
            })
          })
        }
      }, delay)
    })
  }
}

class ProcedureOut implements SimpleTest {
  private static randomIntFromInterval (min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1) + min)
  }

  private static makeid (): string {
    let text = ''
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

    for (let i = 0; i < ProcedureOut.randomIntFromInterval(10, 19); i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)) }

    return text
  }

  public run (connectString: string, argv: Options): void {
    const delay: number = argv.delay == null ? 50 : argv.delay
    console.log(connectString)
    sql.open(connectString, (err: Error, theConnection) => {
      if (err != null) {
        throw err
      }

      const spName = 'test_sp_get_str_str'
      const s1: string = ProcedureOut.makeid()
      const s2: string = ProcedureOut.makeid()

      const def = `alter PROCEDURE <name>(
@id INT,
@name varchar(20) OUTPUT,
@company varchar(20) OUTPUT

)AS
BEGIN
` +
                `   SET @name = '${s1}'\n` +
                `   SET @company = '${s2}'\n` +
                '   RETURN 99;\n' +
                'END\n'
      let x = 0
      env.procedureHelper.createProcedure(spName, def, () => {
        setInterval(() => {
          const pm = theConnection.procedureMgr()
          pm.callproc(spName, [1], function (err, results, output) {
            assert.ifError(err)
            const expected = [99, s1, s2]
            console.log(`${JSON.stringify(output)} x = ${x++}`)
            assert.deepEqual(output, expected, 'results didn\'t match')
          })
        }, delay)
      })
    })
  }
}

class Tvp implements SimpleTest {
  public run (connectString: string, argv: any): void {
    const delay: number = argv.delay == null ? 3000 : argv.delay

    console.log(connectString)
    sql.open(connectString, (err: Error, conn: Connection) => {
      if (err != null) {
        throw err
      }

      setTimeout(() => {
        const pm: ProcedureManager = conn.procedureMgr()
        pm.get('MyCustomStoredProcedure', procedure => {
          if (procedure == null) throw new Error('failed get proc')
          const meta: ProcedureSummary = procedure.getMeta()
          const pTvp = {
            a: 'Father',
            b: 999
          }
          procedure.call([pTvp], (err, results) => {
            if (err != null) {
              console.log(err)
            } else {
              console.log(JSON.stringify(results))
            }
          })
          console.log(JSON.stringify(meta))
        })
      }, delay)
    })
  }
}

class DateTz implements SimpleTest {
  public run (connectString: string, argv: any): void {
    const delay: number = argv.delay == null ? 3000 : argv.delay

    console.log(connectString)
    sql.open(connectString, (err: Error, conn) => {
      if (err != null) {
        throw err
      }
      let x = 1

      conn.setUseUTC(false)
      const expected = new Date('2009-05-27 00:00:00.000')
      setInterval(() => {
        const qs = 'select convert(datetime, \'2009-05-27 00:00:00.000\') as test_field'

        console.log(qs)
        const q = conn.query(qs,
          (err, results: any, more: boolean) => {
            console.log(`[${x}] more = ${more} err ${err} expected ${expected} results ${results[0].test_field}`)
            assert.deepEqual(results[0].test_field, expected)
            if (more) return
            console.log(`[${x}] completes more = ${more}`)
            ++x
          })
        q.on('msg', (err: Error) => {
          console.log(`[${x}]: q.msg = ${err.message}`)
        })
      }, delay)
    })
  }
}

class RaiseErrors implements SimpleTest {
  public run (connectString: string, argv: Options): void {
    const delay: number = argv.delay == null ? 3000 : argv.delay

    sql.open(connectString, (err: Error, conn) => {
      if (err != null) {
        throw err
      }
      let x = 1

      setInterval(() => {
        let qs = ''
        const repeats = 3
        for (let i = 0; i < repeats; ++i) {
          qs += `RAISERROR('[${x}]: Error Number ${i + 1}', 1, 1);`
        }
        const q = conn.query(qs,
          (err, results, more: boolean) => {
            if (more && (err == null) && (results != null) && results.length === 0) {
              return
            }
            console.log(`[${x}] more = ${more} err ${err} results ${JSON.stringify(results)}`)
            if (more) return
            console.log(`[${x}] completes more = ${more}`)
            ++x
          })
        q.on('info', (err: Error) => {
          console.log(`[${x}]: q.info = ${err.message}`)
        })
      }, delay)
    })
  }
}

class BusyConnection implements SimpleTest {
  public run (connectString: string, argv: Options): void {
    const delay: number = argv.delay == null ? 3000 : argv.delay
    const severity: number = argv.severity == null ? 9 : argv.severity
    sql.open(connectString, (err: Error, conn) => {
      if (err != null) {
        throw err
      }
      let x = 1
      setInterval(() => {
        const query = `RAISERROR('User JS Error ${severity}', ${severity}, 1);SELECT ${x}+${x};`
        console.log(query)
        conn.queryRaw(query, (err: Error, results, more: boolean) => {
          console.log('>> queryRaw')
          console.log(err)
          console.log(JSON.stringify(results, null, 2))
          if (more) return
          conn.queryRaw(query, (e, r) => {
            console.log('>> queryRaw2')
            console.log(e)
            console.log(JSON.stringify(r, null, 2))
            ++x
            console.log('<< queryRaw2')
          })
          console.log('<< queryRaw')
        })
      }, delay)
    })
  }
}

class LargeStringSelect implements SimpleTest {
  public run (connectString: string, argv: Options): void {
    const delay: number = argv.delay == null ? 5000 : argv.delay
    sql.open(connectString, (err: Error, conn) => {
      if (err != null) {
        throw err
      }
      let x = 1
      const p = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec tincidunt, metus id vulputate convallis, ligula magna ultricies eros, et convallis leo odio vel sem. Cras ut leo quam. Fusce mattis risus eleifend justo facilisis molestie. Aliquam efficitur posuere nibh ut gravida. Phasellus mauris mi, venenatis sed neque in, rutrum aliquet leo. Nam molestie sapien sem, sed commodo ipsum ullamcorper ac. Etiam mattis fringilla lectus non interdum. Vivamus mi lectus, dictum quis ipsum in, varius pellentesque lacus. Sed vitae pharetra nisl. Fusce ullamcorper molestie leo, vel commodo sem fringilla vel. Nulla tempor libero lectus, eu eleifend ex hendrerit eu. Maecenas sodales ultrices massa.Donec gravida magna lectus, non hendrerit tellus commodo eget. Vivamus porttitor justo in orci semper, a commodo ipsum scelerisque. Nulla tortor leo, tincidunt in convallis sit amet, iaculis sed justo. Nunc rhoncus eget justo quis hendrerit. Ut ornare sit amet mauris nec tincidunt. Phasellus mattis ipsum a libero malesuada, at vestibulum mi facilisis. Mauris posuere erat eget mauris ultrices aliquam.Donec ultricies tellus a augue pulvinar, eget varius urna venenatis. Quisque nisl nulla, gravida quis risus sit amet, scelerisque suscipit tellus. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Quisque sem ex, pretium a condimentum a, semper id massa. Aenean vitae viverra tortor. Mauris sed purus lacinia, laoreet nulla nec, pretium felis. Vivamus quis laoreet purus, nec ultricies orci. Nam purus quam, tincidunt faucibus posuere at, scelerisque nec tortor. In eget urna tincidunt, rutrum tortor vitae, porttitor mi. Quisque faucibus est ut metus bibendum eleifend. Fusce rutrum placerat quam, sed porttitor elit luctus ac. Etiam dictum sagittis sem blandit auctor. Aenean et porta ante, ut imperdiet massa. Vivamus a porttitor risus, porta rhoncus enim. Suspendisse euismod ornare convallis.Vestibulum sit amet nibh tincidunt, lacinia diam sit amet, posuere risus. Curabitur quis malesuada erat. Phasellus ultricies pellentesque blandit. Suspendisse ultricies molestie mollis. Cras vitae ullamcorper est. Donec lacinia, neque vitae pharetra tincidunt, eros libero consequat mauris, vitae dictum erat odio at lectus. Nam tempus, turpis mattis sagittis viverra, nisi nulla fermentum ante, ut rhoncus tortor erat sed massa. Nulla bibendum in mauris at viverra. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Vivamus lacinia nibh aliquet facilisis vehicula. Donec ut porttitor quam. Etiam sagittis magna urna, vitae rutrum dui gravida eu. Nullam molestie leo eros, a condimentum velit ultrices vitae. Duis efficitur tortor arcu, ac facilisis velit accumsan vel.Curabitur elementum tortor nec leo bibendum lobortis porta id neque. Suspendisse quis orci ligula. Nulla sodales, dolor at tincidunt accumsan, nulla turpis fringilla urna, at sagittis dolor tellus eu felis. Nullam sodales quam sed lacus egestas, vitae rutrum orci ornare. Ut magna nisl, porttitor sit amet libero venenatis, facilisis vehicula enim. Vivamus erat nulla, auctor a elementum convallis, malesuada sed elit. Praesent justo elit, rhoncus et magna eget, imperdiet accumsan tellus. Nam sit amet tristique orci, eu mattis justo. Ut elementum erat vel risus fringilla, vel rhoncus neque finibus. Curabitur aliquet felis varius pharetra suscipit. Integer id ullamcorper nunc.Sed nec porta metus. Vivamus aliquam cursus tellus. Nunc aliquam hendrerit justo, vitae semper lectus lobortis quis. Morbi commodo felis eget imperdiet feugiat. Sed ante magna, gravida in metus in, consectetur accumsan risus. Pellentesque sit amet tellus quis ipsum lobortis bibendum vitae efficitur leo. Aliquam a ante justo. Integer pharetra, odio id convallis congue, lectus erat molestie arcu, quis cursus nibh arcu in elit. Ut magna nibh, consectetur sit amet augue eu, mattis lacinia lectus. Phasellus sed enim quis metus maximus ultrices. Proin euismod, odio mollis viverra scelerisque, diam orci porta diam, a elementum nulla dui vitae diam. Morbi nec dapibus purus, non placerat ipsum. Vivamus viverra neque eu pellentesque venenatis. Nulla malesuada ex erat, nec consectetur magna rutrum vitae. Aliquam aliquam turpis nec turpis hendrerit venenatis.Ut ligula sem, convallis vitae tempor in, interdum id odio. Interdum et malesuada fames ac ante ipsum primis in faucibus. Maecenas at euismod felis. Duis cursus arcu ac rutrum finibus. Ut congue dapibus nisi quis facilisis. Vestibulum ultricies faucibus enim aliquam vehicula. Praesent ultrices tortor quis arcu finibus, a fermentum quam blandit. Nullam odio mi, facilisis vitae purus vel, posuere efficitur ipsum.Vestibulum mattis, felis scelerisque ornare posuere, nulla eros mattis dolor, vitae facilisis tortor quam non odio. Donec pretium diam in felis semper lacinia. Cras congue laoreet ipsum, id rutrum magna interdum quis. Donec tristique lectus et cursus porttitor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Nullam imperdiet maximus elit, a placerat dui sagittis rutrum. Morbi odio odio, eleifend quis venenatis non, mattis quis ligula.Pellentesque nec diam ac nisl suscipit facilisis. Integer finibus, orci vel blandit lacinia, magna elit gravida magna, eget lacinia sapien magna ac risus. Fusce convallis purus eu mattis faucibus. Curabitur porttitor tempor lorem quis sagittis. Ut congue ipsum egestas nunc porta, a semper lacus suscipit. Cras pellentesque aliquam dui, ut mattis purus vulputate ut. Nullam vel euismod odio. Vestibulum eros est, blandit non tortor at, pulvinar egestas est. Suspendisse potenti. Fusce sit amet turpis ligula.Suspendisse pharetra est purus, sed hendrerit arcu cursus elementum. Curabitur a nunc rhoncus, laoreet dui et, aliquet velit. Duis ornare egestas rhoncus. Aenean id nisl vitae risus vehicula scelerisque. Cras ac eros a quam interdum facilisis vitae vel risus. Etiam gravida feugiat nulla, eleifend placerat odio. Aliquam id feugiat justo, vel sollicitudin ante. Proin venenatis orci non pulvinar molestie. Ut auctor vel mauris vel varius. Aenean placerat justo sit amet nibh sollicitudin suscipit et dapibus felis. Quisque et ipsum id arcu fermentum pretium in eu quam.Cras sed tincidunt velit, sed tincidunt neque. In tempor nunc at gravida blandit. Nulla facilisi. Nulla egestas ante eget lacus semper egestas. Aliquam ornare felis urna, ut maximus purus rutrum nec. Cras non ultrices felis. Aenean vitae facilisis orci, sed eleifend tellus. Integer laoreet sollicitudin elementum. Donec massa metus, hendrerit et vehicula id, blandit id lacus.Praesent blandit sapien sit amet libero pellentesque feugiat. Curabitur pretium fermentum eleifend. Ut tempor diam in fermentum placerat. Sed commodo eget ipsum quis convallis. Donec vulputate velit non purus scelerisque convallis. Duis urna lacus, semper in porta non, sollicitudin in neque. Sed et facilisis lacus, congue sagittis leo. Duis dictum ac lacus et viverra. Donec tristique dui et faucibus rutrum.Curabitur lacinia ipsum in ligula finibus volutpat. Sed ornare lorem quis faucibus faucibus. Ut gravida quis augue vel vestibulum. Aenean aliquam sapien quis neque faucibus, a condimentum nisl malesuada. Maecenas tellus enim, efficitur ut nunc ac, faucibus ultrices mauris. Praesent ac sem id purus finibus sagittis a sed tortor. Suspendisse aliquet hendrerit magna tincidunt fringilla.Sed at dui eu lectus bibendum sollicitudin. Nullam tincidunt, enim malesuada lobortis gravida, arcu metus accumsan lectus, quis dictum dui purus vel justo. Nulla gravida, mauris a commodo tempor, felis quam hendrerit libero, in feugiat nisl nisi ut purus. Ut eleifend odio faucibus odio condimentum, imperdiet imperdiet ex finibus. Pellentesque quis purus sit amet dui pellentesque dignissim eget posuere dolor. Duis ultrices quam elementum nisl porttitor tristique id in arcu. Pellentesque vulputate ex quis sem mattis, sed suscipit lorem ullamcorper. In in tempus erat. Nulla dictum, dolor nec pretium blandit, ante tellus luctus nisi, ut tincidunt lacus elit sodales posuere. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec tincidunt, metus id vulputate convallis, ligula magna ultricies eros, et convallis leo odio vel sem. Cras ut leo quam. Fusce mattis risus eleifend justo facilisis molestie. Aliquam efficitur posuere nibh ut gravida. Phasellus mauris mi, venenatis sed neque in, rutrum aliquet leo. Nam molestie sapien sem, sed commodo ipsum ullamcorper ac. Etiam mattis fringilla lectus non interdum. Vivamus mi lectus, dictum quis ipsum in, varius pellentesque lacus. Sed vitae pharetra nisl. Fusce ullamcorper molestie leo, vel commodo sem fringilla vel. Nulla tempor libero lectus, eu eleifend ex hendrerit eu. Maecenas sodales ultrices massa.Donec gravida magna lectus, non hendrerit tellus commodo eget. Vivamus porttitor justo in orci semper, a commodo ipsum scelerisque. Nulla tortor leo, tincidunt in convallis sit amet, iaculis sed justo. Nunc rhoncus eget justo quis hendrerit. Ut ornare sit amet mauris nec tincidunt. Phasellus mattis ipsum a libero malesuada, at vestibulum mi facilisis. Mauris posuere erat eget mauris ultrices aliquam.Donec ultricies tellus a augue pulvinar, eget varius urna venenatis. Quisque nisl nulla, gravida quis risus sit amet, scelerisque suscipit tellus. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Quisque sem ex, pretium a condimentum a, semper id massa. Aenean vitae viverra tortor. Mauris sed purus lacinia, laoreet nulla nec, pretium felis. Vivamus quis laoreet purus, nec ultricies orci. Nam purus quam, tincidunt faucibus posuere at, scelerisque nec tortor. In eget urna tincidunt, rutrum tortor vitae, porttitor mi. Quisque faucibus est ut metus bibendum eleifend. Fusce rutrum placerat quam, sed porttitor elit luctus ac. Etiam dictum sagittis sem blandit auctor. Aenean et porta ante, ut imperdiet massa. Vivamus a porttitor risus, porta rhoncus enim. Suspendisse euismod ornare convallis.Vestibulum sit amet nibh tincidunt, lacinia diam sit amet, posuere risus. Curabitur quis malesuada erat. Phasellus ultricies pellentesque blandit. Suspendisse ultricies molestie mollis. Cras vitae ullamcorper est. Donec lacinia, neque vitae pharetra tincidunt, eros libero consequat mauris, vitae dictum erat odio at lectus. Nam tempus, turpis mattis sagittis viverra, nisi nulla fermentum ante, ut rhoncus tortor erat sed massa. Nulla bibendum in mauris at viverra. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Vivamus lacinia nibh aliquet facilisis vehicula. Donec ut porttitor quam. Etiam sagittis magna urna, vitae rutrum dui gravida eu. Nullam molestie leo eros, a condimentum velit ultrices vitae. Duis efficitur tortor arcu, ac facilisis velit accumsan vel.Curabitur elementum tortor nec leo bibendum lobortis porta id neque. Suspendisse quis orci ligula. Nulla sodales, dolor at tincidunt accumsan, nulla turpis fringilla urna, at sagittis dolor tellus eu felis. Nullam sodales quam sed lacus egestas, vitae rutrum orci ornare. Ut magna nisl, porttitor sit amet libero venenatis, facilisis vehicula enim. Vivamus erat nulla, auctor a elementum convallis, malesuada sed elit. Praesent justo elit, rhoncus et magna eget, imperdiet accumsan tellus. Nam sit amet tristique orci, eu mattis justo. Ut elementum erat vel risus fringilla, vel rhoncus neque finibus. Curabitur aliquet felis varius pharetra suscipit. Integer id ullamcorper nunc.Sed nec porta metus. Vivamus aliquam cursus tellus. Nunc aliquam hendrerit justo, vitae semper lectus lobortis quis. Morbi commodo felis eget imperdiet feugiat. Sed ante magna, gravida in metus in, consectetur accumsan risus. Pellentesque sit amet tellus quis ipsum lobortis bibendum vitae efficitur leo. Aliquam a ante justo. Integer pharetra, odio id convallis congue, lectus erat molestie arcu, quis cursus nibh arcu in elit. Ut magna nibh, consectetur sit amet augue eu, mattis lacinia lectus. Phasellus sed enim quis metus maximus ultrices. Proin euismod, odio mollis viverra scelerisque, diam orci porta diam, a elementum nulla dui vitae diam. Morbi nec dapibus purus, non placerat ipsum. Vivamus viverra neque eu pellentesque venenatis. Nulla malesuada ex erat, nec consectetur magna rutrum vitae. Aliquam aliquam turpis nec turpis hendrerit venenatis.Ut ligula sem, convallis vitae tempor in, interdum id odio. Interdum et malesuada fames ac ante ipsum primis in faucibus. Maecenas at euismod felis. Duis cursus arcu ac rutrum finibus. Ut congue dapibus nisi quis facilisis. Vestibulum ultricies faucibus enim aliquam vehicula. Praesent ultrices tortor quis arcu finibus, a fermentum quam blandit. Nullam odio mi, facilisis vitae purus vel, posuere efficitur ipsum.Vestibulum mattis, felis scelerisque ornare posuere, nulla eros mattis dolor, vitae facilisis tortor quam non odio. Donec pretium diam in felis semper lacinia. Cras congue laoreet ipsum, id rutrum magna interdum quis. Donec tristique lectus et cursus porttitor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Nullam imperdiet maximus elit, a placerat dui sagittis rutrum. Morbi odio odio, eleifend quis venenatis non, mattis quis ligula.Pellentesque nec diam ac nisl suscipit facilisis. Integer finibus, orci vel blandit lacinia, magna elit gravida magna, eget lacinia sapien magna ac risus. Fusce convallis purus eu mattis faucibus. Curabitur porttitor tempor lorem quis sagittis. Ut congue ipsum egestas nunc porta, a semper lacus suscipit. Cras pellentesque aliquam dui, ut mattis purus vulputate ut. Nullam vel euismod odio. Vestibulum eros est, blandit non tortor at, pulvinar egestas est. Suspendisse potenti. Fusce sit amet turpis ligula.Suspendisse pharetra est purus, sed hendrerit arcu cursus elementum. Curabitur a nunc rhoncus, laoreet dui et, aliquet velit. Duis ornare egestas rhoncus. Aenean id nisl vitae risus vehicula scelerisque. Cras ac eros a quam interdum facilisis vitae vel risus. Etiam gravida feugiat nulla, eleifend placerat odio. Aliquam id feugiat justo, vel sollicitudin ante. Proin venenatis orci non pulvinar molestie. Ut auctor vel mauris vel varius. Aenean placerat justo sit amet nibh sollicitudin suscipit et dapibus felis. Quisque et ipsum id arcu fermentum pretium in eu quam.Cras sed tincidunt velit, sed tincidunt neque. In tempor nunc at gravida blandit. Nulla facilisi. Nulla egestas ante eget lacus semper egestas. Aliquam ornare felis urna, ut maximus purus rutrum nec. Cras non ultrices felis. Aenean vitae facilisis orci, sed eleifend tellus. Integer laoreet sollicitudin elementum. Donec massa metus, hendrerit et vehicula id, blandit id lacus.Praesent blandit sapien sit amet libero pellentesque feugiat. Curabitur pretium fermentum eleifend. Ut tempor diam in fermentum placerat. Sed commodo eget ipsum quis convallis. Donec vulputate velit non purus scelerisque convallis. Duis urna lacus, semper in porta non, sollicitudin in neque. Sed et facilisis lacus, congue sagittis leo. Duis dictum ac lacus et viverra. Donec tristique dui et faucibus rutrum.Curabitur lacinia ipsum in ligula finibus volutpat. Sed ornare lorem quis faucibus faucibus. Ut gravida quis augue vel vestibulum. Aenean aliquam sapien quis neque faucibus, a condimentum nisl malesuada. Maecenas tellus enim, efficitur ut nunc ac, faucibus ultrices mauris. Praesent ac sem id purus finibus sagittis a sed tortor. Suspendisse aliquet hendrerit magna tincidunt fringilla.Sed at dui eu lectus bibendum sollicitudin. Nullam tincidunt, enim malesuada lobortis gravida, arcu metus accumsan lectus, quis dictum dui purus vel justo. Nulla gravida, mauris a commodo tempor, felis quam hendrerit libero, in feugiat nisl nisi ut purus. Ut eleifend odio faucibus odio condimentum, imperdiet imperdiet ex finibus. Pellentesque quis purus sit amet dui pellentesque dignissim eget posuere dolor. Duis ultrices quam elementum nisl porttitor tristique id in arcu. Pellentesque vulputate ex quis sem mattis, sed suscipit lorem ullamcorper. In in tempus erat. Nulla dictum, dolor nec pretium blandit, ante tellus luctus nisi, ut tincidunt lacus elit sodales posuere. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Donec tincidunt, metus id vulputate convallis, ligula magna ultricies eros, et convallis leo odio vel sem. Cras ut leo quam. Fusce mattis risus eleifend justo facilisis molestie. Aliquam efficitur posuere nibh ut gravida. Phasellus mauris mi, venenatis sed neque in, rutrum aliquet leo. Nam molestie sapien sem, sed commodo ipsum ullamcorper ac. Etiam mattis fringilla lectus non interdum. Vivamus mi lectus, dictum quis ipsum in, varius pellentesque lacus. Sed vitae pharetra nisl. Fusce ullamcorper molestie leo, vel commodo sem fringilla vel. Nulla tempor libero lectus, eu eleifend ex hendrerit eu. Maecenas sodales ultrices massa.Donec gravida magna lectus, non hendrerit tellus commodo eget. Vivamus porttitor justo in orci semper, a commodo ipsum scelerisque. Nulla tortor leo, tincidunt in convallis sit amet, iaculis sed justo. Nunc rhoncus eget justo quis hendrerit. Ut ornare sit amet mauris nec tincidunt. Phasellus mattis ipsum a libero malesuada, at vestibulum mi facilisis. Mauris posuere erat eget mauris ultrices aliquam.Donec ultricies tellus a augue pulvinar, eget varius urna venenatis. Quisque nisl nulla, gravida quis risus sit amet, scelerisque suscipit tellus. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Quisque sem ex, pretium a condimentum a, semper id massa. Aenean vitae viverra tortor. Mauris sed purus lacinia, laoreet nulla nec, pretium felis. Vivamus quis laoreet purus, nec ultricies orci. Nam purus quam, tincidunt faucibus posuere at, scelerisque nec tortor. In eget urna tincidunt, rutrum tortor vitae, porttitor mi. Quisque faucibus est ut metus bibendum eleifend. Fusce rutrum placerat quam, sed porttitor elit luctus ac. Etiam dictum sagittis sem blandit auctor. Aenean et porta ante, ut imperdiet massa. Vivamus a porttitor risus, porta rhoncus enim. Suspendisse euismod ornare convallis.Vestibulum sit amet nibh tincidunt, lacinia diam sit amet, posuere risus. Curabitur quis malesuada erat. Phasellus ultricies pellentesque blandit. Suspendisse ultricies molestie mollis. Cras vitae ullamcorper est. Donec lacinia, neque vitae pharetra tincidunt, eros libero consequat mauris, vitae dictum erat odio at lectus. Nam tempus, turpis mattis sagittis viverra, nisi nulla fermentum ante, ut rhoncus tortor erat sed massa. Nulla bibendum in mauris at viverra. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Vivamus lacinia nibh aliquet facilisis vehicula. Donec ut porttitor quam. Etiam sagittis magna urna, vitae rutrum dui gravida eu. Nullam molestie leo eros, a condimentum velit ultrices vitae. Duis efficitur tortor arcu, ac facilisis velit accumsan vel.Curabitur elementum tortor nec leo bibendum lobortis porta id neque. Suspendisse quis orci ligula. Nulla sodales, dolor at tincidunt accumsan, nulla turpis fringilla urna, at sagittis dolor tellus eu felis. Nullam sodales quam sed lacus egestas, vitae rutrum orci ornare. Ut magna nisl, porttitor sit amet libero venenatis, facilisis vehicula enim. Vivamus erat nulla, auctor a elementum convallis, malesuada sed elit. Praesent justo elit, rhoncus et magna eget, imperdiet accumsan tellus. Nam sit amet tristique orci, eu mattis justo. Ut elementum erat vel risus fringilla, vel rhoncus neque finibus. Curabitur aliquet felis varius pharetra suscipit. Integer id ullamcorper nunc.Sed nec porta metus. Vivamus aliquam cursus tellus. Nunc aliquam hendrerit justo, vitae semper lectus lobortis quis. Morbi commodo felis eget imperdiet feugiat. Sed ante magna, gravida in metus in, consectetur accumsan risus. Pellentesque sit amet tellus quis ipsum lobortis bibendum vitae efficitur leo. Aliquam a ante justo. Integer pharetra, odio id convallis congue, lectus erat molestie arcu, quis cursus nibh arcu in elit. Ut magna nibh, consectetur sit amet augue eu, mattis lacinia lectus. Phasellus sed enim quis metus maximus ultrices. Proin euismod, odio mollis viverra scelerisque, diam orci porta diam, a elementum nulla dui vitae diam. Morbi nec dapibus purus, non placerat ipsum. Vivamus viverra neque eu pellentesque venenatis. Nulla malesuada ex erat, nec consectetur magna rutrum vitae. Aliquam aliquam turpis nec turpis hendrerit venenatis.Ut ligula sem, convallis vitae tempor in, interdum id odio. Interdum et malesuada fames ac ante ipsum primis in faucibus. Maecenas at euismod felis. Duis cursus arcu ac rutrum finibus. Ut congue dapibus nisi quis facilisis. Vestibulum ultricies faucibus enim aliquam vehicula. Praesent ultrices tortor quis arcu finibus, a fermentum quam blandit. Nullam odio mi, facilisis vitae purus vel, posuere efficitur ipsum.Vestibulum mattis, felis scelerisque ornare posuere, nulla eros mattis dolor, vitae facilisis tortor quam non odio. Donec pretium diam in felis semper lacinia. Cras congue laoreet ipsum, id rutrum magna interdum quis. Donec tristique lectus et cursus porttitor. Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia Curae; Nullam imperdiet maximus elit, a placerat dui sagittis rutrum. Morbi odio odio, eleifend quis venenatis non, mattis quis ligula.Pellentesque nec diam ac nisl suscipit facilisis. Integer finibus, orci vel blandit lacinia, magna elit gravida magna, eget lacinia sapien magna ac risus. Fusce convallis purus eu mattis faucibus. Curabitur porttitor tempor lorem quis sagittis. Ut congue ipsum egestas nunc porta, a semper lacus suscipit. Cras pellentesque aliquam dui, ut mattis purus vulputate ut. Nullam vel euismod odio. Vestibulum eros est, blandit non tortor at, pulvinar egestas est. Suspendisse potenti. Fusce sit amet turpis ligula.Suspendisse pharetra est purus, sed hendrerit arcu cursus elementum. Curabitur a nunc rhoncus, laoreet dui et, aliquet velit. Duis ornare egestas rhoncus. Aenean id nisl vitae risus vehicula scelerisque. Cras ac eros a quam interdum facilisis vitae vel risus. Etiam gravida feugiat nulla, eleifend placerat odio. Aliquam id feugiat justo, vel sollicitudin ante. Proin venenatis orci non pulvinar molestie. Ut auctor vel mauris vel varius. Aenean placerat justo sit amet nibh sollicitudin suscipit et dapibus felis. Quisque et ipsum id arcu fermentum pretium in eu quam.Cras sed tincidunt velit, sed tincidunt neque. In tempor nunc at gravida blandit. Nulla facilisi. Nulla egestas ante eget lacus semper egestas. Aliquam ornare felis urna, ut maximus purus rutrum nec. Cras non ultrices felis. Aenean vitae facilisis orci, sed eleifend tellus. Integer laoreet sollicitudin elementum. Donec massa metus, hendrerit et vehicula id, blandit id lacus.Praesent blandit sapien sit amet libero pellentesque feugiat. Curabitur pretium fermentum eleifend. Ut tempor diam in fermentum placerat. Sed commodo eget ipsum quis convallis. Donec vulputate velit non purus scelerisque convallis. Duis urna lacus, semper in porta non, sollicitudin in neque. Sed et facilisis lacus, congue sagittis leo. Duis dictum ac lacus et viverra. Donec tristique dui et faucibus rutrum.Curabitur lacinia ipsum in ligula finibus volutpat. Sed ornare lorem quis faucibus faucibus. Ut gravida quis augue vel vestibulum. Aenean aliquam sapien quis neque faucibus, a condimentum nisl malesuada. Maecenas tellus enim, efficitur ut nunc ac, faucibus ultrices mauris. Praesent ac sem id purus finibus sagittis a sed tortor. Suspendisse aliquet hendrerit magna tincidunt fringilla.Sed at dui eu lectus bibendum sollicitudin. Nullam tincidunt, enim malesuada lobortis gravida, arcu metus accumsan lectus, quis dictum dui purus vel justo. Nulla gravida, mauris a commodo tempor, felis quam hendrerit libero, in feugiat nisl nisi ut purus. Ut eleifend odio faucibus odio condimentum, imperdiet imperdiet ex finibus. Pellentesque quis purus sit amet dui pellentesque dignissim eget posuere dolor. Duis ultrices quam elementum nisl porttitor tristique id in arcu. Pellentesque vulputate ex quis sem mattis, sed suscipit lorem ullamcorper. In in tempus erat. Nulla dictum, dolor nec pretium blandit, ante tellus luctus nisi, ut tincidunt lacus elit sodales posuere.'
      const query = `SELECT 'Result' AS [Result], '${p}' AS [ReallyLongString]`
      setInterval(() => {
        const q = conn.query(query,
          (err, results, more: boolean) => {
            console.log(`[${x}] more = ${more} err ${err} results ${JSON.stringify(results)}`)
            if (more) return
            ++x
          })
        q.on('row', (row: number) => {
          console.log(`[column:${x}]: row = ${row}`)
        })
        q.on('column', (col: number, data: any, more: boolean) => {
          console.log(`[column:${x}]: col = ${col} data.length ${data.length}, more : ${more} p.length ${p.length}`)
        })
      }, delay)
    })
  }
}

class PrintSelect implements SimpleTest {
  public run (connectString: string, argv: Options): void {
    const delay: number = argv.delay == null ? 5000 : argv.delay

    sql.open(connectString, (err: Error, conn) => {
      if (err != null) {
        throw err
      }
      let x = 1

      setInterval(() => {
        conn.query(`print 'JS status message ${x}'; SELECT ${x} + ${x} as res;SELECT ${x} * ${x} as res2`,
          (err, results, more: boolean) => {
            if (more && (err == null) && (results != null) && results.length === 0) {
              return
            }
            console.log(`[${x}] more = ${more} err ${err} results ${JSON.stringify(results)}`)
            if (more) return
            ++x
          })
      }, delay)
    })
  }
}

class MemoryStress implements SimpleTest {
  private async promised (conn: Connection, sql: string): Promise<any> {
    return await new Promise((resolve, reject) => {
      conn.queryRaw(sql, (err, results) => {
        if (err != null) {
          reject(err)
        }
        resolve(results)
      })
    })
  }

  async run (connectString: string, argv: Options): Promise<void> {
    const iterations = argv.iterations == null ? 10000 : argv.iterations
    sql.open(connectString, async (err: Error, conn: Connection) => {
      if (err != null) {
        throw err
      }
      const x = 1
      let iteration = 0
      while (iteration++ < iterations) {
        const results = await this.promised(conn, `SELECT ${x}+${x};`)
        if (iteration % 1000 === 0) {
          console.log(`iteration = ${iteration} out of ${iterations}`)
          console.log(results)
        }
      }
    })
  }
}

let test: SimpleTest | undefined

switch (argv.t) {
  case 'tvp':
    test = new Tvp()
    break

  case 'datetz':
    test = new DateTz()
    break

  case 'busy':
    test = new BusyConnection()
    break

  case 'large':
    test = new LargeStringSelect()
    break

  case 'memory':
    test = new MemoryStress()
    break

  case 'print':
    test = new PrintSelect()
    break

  case 'errors':
    test = new RaiseErrors()
    break

  case 'connection':
    test = new PrintConnection()
    break

  case 'benchmark':
    test = new Benchmark()
    break

  case 'procedure':
    test = new ProcedureOut()
    break

  default:
    console.log(`test ${argv.t} is not valid.`)
    test = undefined
    break
}

env.open().then(() => {
  if (test != null) {
    test.run(env.connectionString, argv)
  }
}).catch((e: Error) => {
  console.error(e)
})
