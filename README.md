# WAO - Wizard AO SDK & Testing

![](./assets/cover.png)

WAO SDK streamlines Arweave/AO development with elegant syntax enhancements and seamless message piping for an enjoyable coding experience. GraphQL operations are also made super easy.

Additionally, it includes a drop-in replacement for `aoconnect`, allowing to test lua scripts 1000x faster than the mainnet by emulating AO units in-memory. It's even 100x faster than testing with [arlocal](https://github.com/textury/arlocal) and [ao-localnet](https://github.com/permaweb/ao-localnet).

- [Quick Start](#quick-start)
  - [Installation](#installation)
  
- [API Reference](#api-reference)
  - [AR](#ar)
  - [AO](#ao)
  - [GQL](#gql)

## Quick Start

*WAO is still actively being developed; please use it with discretion.*

### Installation

```bash
yarn add wao
```
### Drop-in `aoconnect` Replacement for Tests

By replacing `aoconnect` with WAO connect, everything runs in-memory with zero latency and your tests execute 1000x faster. The APIs are identical. So there's no need to change anything else in your code.

```js
//import { spawn, message, dryrun, assign, result } from "@permaweb/aoconnect"
import { connect } from "wao/test"
const { spawn, message, dryrun, assign, result } = connect()
```

### Setting up a Project

It's super easy to set up a test AO project manually.

```bash
mkdir wao-test && cd wao-test
yarn init && yarn add wao && yarn add mocha chai --dev
```

Add a `test` command to your `package.json`, and set `module` type to work with ES6.

```json
{
  "name": "wao-test",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "wao": "^0.1.1"
  },
  "devDependencies": {
    "chai": "^5.1.2",
    "mocha": "^10.8.2"
  },
  "scripts": {
    "test": "mocha --node-option=experimental-wasm-memory64"
  }
}
```

Create `test` directory and `test.js` file.

```bash
mkdir test && touch test.js
```

### Writing Tests

Write a simple test in `test.js`.

```js
import { expect } from "chai"
import { connect } from "wao/test"
const { acc, spawn, message, dryrun } = connect()
// import { wait } from "wao/utils"

const src_data = `
Handlers.add("Hello", "Hello", function (msg)
  msg.reply({ Data = "Hello, World!" })
end)
`

describe("WAO", function () {
  this.timeout(0)
  describe("Aoconnect Replacement", function () {
    it("should spawn a process and send messages", async () => {
      const pid = await spawn({ signer: acc[0].signer })
	  
	  // on mainnet, you need to wait here till the process becomes available.
	  // WAO automatically handles it. No need with in-memory tests.
	  // await wait({ pid })
	  
      await message({
        process: pid,
        tags: [{ name: "Action", value: "Eval" }],
        data: src_data,
        signer,
      })
      const res = await dryrun({
        process: pid,
        tags: [{ name: "Action", value: "Hello" }],
        signer,
      })
      expect(res.Messages[0].Data).to.eql("Hello, World!")
    })
  })
})
```
Note that generating random Arweave wallets for every test takes time and slows down your test executions, so Wao connect provides pre-generated accounts for your tests, which saves hours if you are to run your tests thousands of times.

- `acc[0] = { jwk, addr, signer }`

Run the test.

```js
yarn test
```

WAO comes with elegant syntactic sugar and makes writing AO projects absolute joy.

The same test can be written as follows.

```js
import { expect } from "chai"
import { AO, acc } from "wao/test"

const src_data = `
Handlers.add( "Hello", "Hello", function (msg)
  msg.reply({ Data = "Hello, World!" })
end)
`
describe("WAO", function () {
  this.timeout(0)
  describe("AO Class", function () {
    it("should spawn a process send messages", async () => {
      const ao = await new AO().init(acc[0])
      const { p } = await ao.deploy({ src_data })
      expect(await p.d("Hello")).to.eql("Hello, World!")
    })
  })
})
```

The `AO` class is not only for tests, but also for production code. You just need to import from a different path.

- `import { AO } from "wao"`

## API Reference

### AR

`AR` handles operations on the base Arweave Storage layer as well as wallet connections.

- [Instantiate](#instantiate)
- [Set or Generate Wallet](#set-or-generate-wallet)
- [toAddr](#toaddr)
- [mine](#mine)
- [balance | toAR | toWinston](#balance--toar--towinston)
- [transfer](#transfer)
- [checkWallet](#checkwallet)
- [post](#post)
- [tx](#tx)
- [data](#data)
- [bundle](#bundle)

#### Instantiate

```js
import { AR } from "wao"
const ar = new AR()
```
`host`, `port`, and `protocol` can be set to access a specific gateway rather than `https://arweave.net`.

```js
const ar = new AR({ host: "localhost", port: 4000, protocol: "http" })
```

In case of local gateways, you can only set `port` and the rest will be automatically figured out.
```js
const ar = new AR({ port: 4000 })
```

#### Set or Generate Wallet

You can initialize AR with a wallet JWK or ArConnect.

```js
const ar = await new AR().init(jwk || arweaveWallet)
```

Or you can generate a new wallet. In case of ArLocal, you can mint AR at the same time.

```js
const { jwk, addr, pub, balance } = await ar.gen("100") // mint 100 AR
```

Once a wallet is set in one of these 3 ways, you cannot use the instance with another wallet unless you re-initialize it with another wallet. This is to prevent executing transactions with the wrong wallet when the browser connected active address has been changed unknowingly.

You can go on without calling `init` or `gen`, in this case, AR generates a random wallet when needed, and also using different wallets will be allowed. This is useful, if you are only calling `dryrun` with AO, since AO requires a signature for `dryrun` too, but you don't want to bother the user by triggering the browser extension wallet for read only calls.

Once a wallet is set, `ar.jwk` and `ar.addr` will be available.

#### Token Related Methods

##### toAddr

Convert a jwk to the corresponding address.

```js
const addr = await ar.toAddr(jwk)
```

##### mine

Mine pending blocks (only for arlocal).

```js
await ar.mine()
```

##### balance | toAR | toWinston

Get the current balance of the specified address in AR. `addr` will be `ar.addr` if omitted.

```js
const balance_AR = await ar.balance() // get own balance
const balance_Winston = ar.toWinston(balance_AR)
const balance_AR2 = ar.toAR(balance_Winston)
const balance_AR3 = await ar.balance(addr) // specify wallet address
```

##### transfer

Transfer AR token. `amount` is in AR, not in winston for simplicity.

```js
const { id } = await ar.transfer(amount, to)
```

You can set a jwk to the 3rd parameter as a sender, otherwise the sender is `ar.jwk`.

```js
const { id } = await ar.transfer(amount, to, jwk)
```

For most write functions, `jwk` can be specified as the last parameter or a field like `{ data, tags, jwk }`.


##### checkWallet

`checkWallet` is mostly used internally, but it returns `this.jwk` if a wallet has been assigned with `init`, or else it generates a random wallet to use. The following pattern is used in many places. With this pattern, if a wallet is set with `init` and the `jwk` the user is passing is different, `checkWallet` produces an error to prevent the wrong wallet. If no wallet has been set with `init` or `gen` and the `jwk` is not passed, it generates and returns a random wallet.

```js
some_class_method({ jwk }){
  let err = null
  ;({ err, jwk } = await ar.checkWallet({ jwk }))
  if(!err){
    // do domething with the jwk
  }
}
```

#### Storage Related Methods

##### post 

Post a data to Arweave.

```js
const { err, id } = await ar.post({ data, tags })
```

`tags` are not an Array but a hash map Object for brevity.

```js
const tags = { "Content-Type": "text/markdown", Type: "blog-post" }
```

If you must use the same name for multiple tags, the value can be an Array.

```js
const tags = { Name: [ "name-tag-1", "name-tag-2" ] }
```


##### tx

Get a transaction.

```js
const tx = await ar.tx(txid)
```

##### data

Get a data.

```js
const data = await ar.data(txid, true) // true if string
```

##### bundle

Bundle ANS-104 dataitems.

```js
const { err, id } = await ar.bundle(dataitems)
```
`dataitems` are `[ [ data, tags ], [ data, tags ], [ data, tags ] ]`.
```js
const { err, id } = await ar.bundle([
  [ "this is text", { "Content-Type": "text/plain" }],
  [ "# this is markdown", { "Content-Type": "text/markdown" }],
  [ png_image, { "Content-Type": "image/png" }]
])
```

### AO

- [Instantiate](#instantiate-1)
- [deploy](#deploy)
- [msg](#msg)
- [dry](#dry)
- [asgn](#asgn)
- [load](#load)
- [eval](#eval)
- [spwn](#spwn)
- [aoconnect Functions](#aoconnect-functions)
- [postModule](#postmodule)
- [postScheduler](#postscheduler)
- [wait](#wait)
- [Function Piping](#function-piping)

#### Instantiate

You can initialize AO in the same way as AR.

```js
import { AO } from "wao"
const ao = await new AO().init(arweaveWallet || jwk)
```
If you need to pass AR settings, use `ar`. `ao.ar` will be automatically available.

```js
const ao = await new AO({ ar: { port: 4000 }}).init(arweaveWallet || jwk)
const addr = ao.ar.addr
await ao.ar.post({ data, tags })
```

#### AO Core Functions

##### deploy

Spawn a process, get a Lua source, and eval the script. `src` is an Arweave txid of the Lua script.

```js
const { err, res, pid } = await ao.deploy({ data, tags, src, fills })
```

`fills` replace the Lua source script from `src`.

```lua
local replace_me = '<REPLACE_ME>'
local replace_me_again = '<REPLACE_ME_AGAIN>'
local replace_me_with_hello_again = '<REPLACE_ME>'
```

```js
const fills = { REPLACE_ME: "hello", REPLACE_ME_AGAIN: "world" }
```
This will end up in the following lua script.

```lua
local replace_me = 'hello'
local replace_me_again = 'world'
local replace_me_with_hello_again = 'hello'
```

In case you have multiple scripts, use `loads` and pass `src` and `fills` respectively.

```js
await ao.deploy({ tags, loads: [ { src, fills }, { src: src2, fills: fills2 } ] })
```


##### msg

Send a message.


```js
const { err, mid, res, out } = await ao.msg({ 
  data, action, tags, check, checkData, get
})
```

`check` determins if the message call is successful by checking through `Tags` in `Messages` in `res`.

```js
const check = { "Status" : "Success" } // succeeds if Status tag is "Success"
const check2 = { "Status" : true } // succeeds if Status tag exists
```


`checkData` checks `Data` field instead of `Tags`.

```js
const checkData = "Success"  // succeeds if Data field is "Success"
const checkData2 = true // succeeds if Data field exists
```

`get` will return specified data via `out`.


```js
const get = "ID" // returns the value of "ID" tag
const get2 = { name: "Profile", json: true } // "Profile" tag with JSON.parse()
const get3 = { data: true, json: true } // returns Data field with JSON.parse()
```

##### dry

Dryrun a message without writing to Arweave.


```js
const { err, res, out } = await ao.dry({ 
  data, action, tags, check, checkData, get
})
```

##### asgn

Assign an existing message to a process.

```js
const { err, mid, res, out } = await ao.asgn({ pid, mid, check, checkData, get })
```

##### load

Get a Lua source script from Arweave and eval it on a process.

```js
const { err, res, mid } = await ao.load({ src, fills, pid })
```

##### eval

Eval a Lua script on a process.

```js
const { err, res, mid } = await ao.eval({ pid, data })
```

##### spwn

Spawn a process. `module` and `scheduler` are auto-set if omitted.

```js
const { err, res, pid } = await ao.spwn({ module, scheduler, tags, data })
```

#### aoconnect Functions

The original aoconnect functions `message` | `spawn` | `result` | `assign` | `dryrun`  are also available.  
`createDataItemSigner` is available as `toSigner`.

```js
const signer = ao.toSigner(jwk)
const process = await ao.spawn({ module, scheduler, signer, tags, data })
const message = await ao.message({ process, signer, tags, data })
const result = await ao.result({ process, message })
```

#### Advanced Functions

##### postModule

`data` should be wasm binary. `overwrite` to replace the default module set to the AO instance.

```js
const { err, id: module } = await ao.postModule({ data, jwk, tags, overwrite })

```

##### postScheduler

This will post `Scheduler-Location` with the `jwk` address as the returning `scheduler`.

```js
const { err, scheduler } = await ao.postScheduler({ url, jwk, tags, overwrite })
```

##### wait

`wait` untill the process becomes available after `spwn`. This is mostly used internally with `deploy`.

```js
const { err } = await ao.wait({ pid })
```

#### Function Piping

Most functions return in the format of `{ err, res, out, pid, mid, id }`, and these function can be chained with `pipe`, which makes executing multiple messages a breeze.

For example, following is how `deploy` uses `pipe` internally. The execusion will be immediately aborted if any of the functions in `fns` produces an error.

```js
let fns = [
  {
    fn: "spwn",
    args: { module, scheduler, tags, data },
    then: { "args.pid": "pid" },
   },
   { fn: "wait", then: { "args.pid": "pid" } },
   { fn: "load", args: { src, fills }, then: { "args.pid": "pid" } }
]
const { err, res, out, pid } = await this.pipe({ jwk, fns })
```

##### bind

If the function comes from other instances rather than `AO`, use `bind`.

```js
const fns = [{ fn: "post", bind: this.ar, args: { data, tags }}]
```

##### then

You can pass values between functions with `then`. For instance, passing the result from the previous functions to the next function's arguments is a common operation.

```js
const fns = [
  { fn: "post", bind: ao.ar, args: { data, tags }, then: ({ id, args, out })=>{
    args.tags.TxId = id // adding TxId tag to `msg` args
	out.txid = id // `out` will be returned at last with `pipe`
  }},
  { fn: "msg", args: { pid, tags }},
]
const { out: { txid } } = await ao.pipe({ fns, jwk })
```

If `then` returns a value, `pipe` will immediately return with that single value. You can also use `err` to abort `pipe` with an error.

```js
const fns = [
  { fn: "msg", args: { pid, tags }, then: ({ inp })=>{
     if(inp.done) return inp.val
  }},
  { fn: "msg", args: { pid, tags }, err: ({ inp })=>{
     if(!inp.done) return "something went wrong"
  }},
]
const val = await ao.pipe({ jwk, fns })

```

`then` has many useful parameters.

- `res` : `res` from the previous result
- `args` : `args` for the next function
- `out` : `out` the final `out` result from the `pipe` sequence
- `inp` : `out` from the previous result
- `_` : if values are assigned to the `_` fields, `pipe` returns them as top-level fields in the end
- `pid` : `pid` will be passed if any previous functions returns `pid` ( e.g. `deploy` )
- `mid` : `mid` will be passed if any previous functions returns `mid` ( e.g. `msg` )
- `id` : `id` will be passed if any previous functions returns `id` ( e.g. `post` )

`then` can be a simplified hashmap object.

```js
let fns = [
  {
    fn: "msg",
    args: { tags },
    then: { "args.mid": "mid", "out.key": "inp.a", "_.val": "inp.b" },
   }, 
   { fn: "some_func", args: {} } // args.mid will be set from the previous `then`
]
const { out: { key }, val } = await ao.pipe({ jwk, fns })
```

##### cb

`cb` can report the current progress of `pipe` after every function execution.

```js
await ao.pipe({ jwk, fns, cb: ({ i, fns, inp })=>{
  console.log(`${i} / ${fns.length} functions executed`)
}})
```

### GQL

`GQL` simplifies [the Arwave GraphQL](https://gql-guide.vercel.app/) operations to query blocks and transactions.

- [Instantiate](#instantiate-2)
- [Txs](#txs)
- [Blocks](#blocks)

#### Instantiate

You can instanciate the GQL class with an endpoint `url`.

```js
import { GQL } from "wao"
const gql = new GQL({ url: "https://arweave.net/graphql" }) // the default url
```

#### Txs

Get latest transactions.

```js
const txs = await gql.txs()
```

##### asc

Get transactions in ascending order.

```js
const txs = await gql.txs({ asc: true })
```

##### first

Get the firxt X transactions.

```js
const txs = await gql.txs({ first: 3 })
```

##### after

Get transactions after a specific one to paginate. Pass a `cursor`.

```js
const txs = await gql.txs({ first: 3 })
const txs2 = await gql.txs({ first: 3, after: txs[2].cursor })
```

##### next

Easier pagination with `next`.

```js
const { next, data: txs0_2 } = await gql.txs({ first: 3, next: true })
const { next: next2, data: txs3_5 } = await next()
const { next: next3, data: txs6_8 } = await next2()
```

`res.next` will be `null` if there's no more transactions to paginate.

##### block

Get transactions within a block height range.

```js
const txs = await gql.txs({ block: { min: 0, max: 10 } })
```

or


```js
const txs = await gql.txs({ block: [0, 10] })
```

You can also specify only `min` or `max`.

##### by Transaction IDs

Get transactions by transaction ids.

```js
const txs = await gql.txs({ id: TXID })
```
or

```js
const txs = await gql.txs({ ids: [ TXID1, TXID2, TXID3 ] })
```

##### by Recipients

Get transactions by recipients.

```js
const txs = await gql.txs({ recipient: ADDR })
```
or

```js
const txs = await gql.txs({ recipients: [ ADDR1, ADDR2, ADDR3 ] })
```

##### by Owners

Get transactions by owners.

```js
const txs = await gql.txs({ owner: ADDR })
```
or

```js
const txs = await gql.txs({ owners: [ ADDR1, ADDR2, ADDR3 ] })
```

##### by Tags

Get transactions that match tags.

```js
const txs = await gql.txs({ tags: { Name: "Bob", Age: "30" } })
```

##### fields

Choose fields to be returned.

```js
const txs = await gql.txs({ fields: ["id", "recipient"] })
```

For nested objects,

```js
const txs = await gql.txs({ fields: ["id", { owner: ["address", "key"] }] })
```

You can use a hashmap to specify fields too.

```js
const txs = await gql.txs({ 
  fields: { id: true, { owner: { address: true, key: true } } } 
})
```

If you assign `false`, the other fields will be returned.

```js
const txs = await gql.txs({ 
  fields: { id: true, { block: { previous: false } } } 
})
```

For example, the above will exclude `previous` from `block` and return `id`, `timestamp` and `height`.

The entire available fields for transactions as in a graphql query are as follows.

```js
const tx_fields = `{
  id 
  anchor 
  signature 
  recipient 
  owner { address key } 
  fee { winston ar } 
  quantity { winston ar } 
  data { size type } 
  tags { name value } 
  block { id timestamp height previous } 
  parent { id }
}`
```

#### Blocks

Get latest blocks.

```js
const blocks = await gql.blocks()
```

##### asc

Get blocks in ascending order.

```js
const blocks = await gql.blocks({ asc: true })
```

##### first

Get the firxt X blocks.

```js
const blocks = await gql.blocks({ first: 3 })
```

##### after

Get blocks after a specific one to paginate. Pass a `cursor`.

```js
const blocks = await gql.blocks({ first: 3 })
const blocks2 = await gql.blocks({ first: 3, after: blocks[2].cursor })
```

##### by Block IDs

Get blocks by block ids.

```js
const blocks = await gql.blocks({ id: BLCID })
```
or

```js
const blocks = await gql.blocks({ ids: [ BLKID1, BLKID2, BLKID3 ] })
```

##### height

Get blocks within a block height range.

```js
const blocks = await gql.blocks({ height: { min: 0, max: 10 } })
```

or


```js
const blocks = await gql.blocks({ height: [0, 10] })
```

##### next

Easier pagination with `next`.

```js
const { next, data: blocks0_2 } = await gql.blocks({ first: 3, next: true })
const { next: next2, data: blocks3_5 } = await next() 
const { next: next3, data: blocks6_8 } = await next2()
```

`res.next` will be `null` if there's no more blocks to paginate.

##### fields

```js
const blocks = await gql.blocks({ 
  fields: ["id", "timestamp", "height", "previous" ]
})
```

The entire available fields for transactions as in a graphql query are as follows.

```js
const block_fields = `{ id timestamp height previous }`
```
