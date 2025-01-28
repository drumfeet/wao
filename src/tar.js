import MAR from "./ar.js"
import { buildTags, tags as t } from "./utils.js"
import * as WarpArBundles from "warp-arbundles"
const pkg = WarpArBundles.default ?? WarpArBundles
const { DataItem } = pkg
import { bundleAndSignData, ArweaveSigner } from "arbundles"
import base64url from "base64url"
import ArMem from "./armem.js"
import GQL from "./tgql.js"
import { last, is, includes, isNil } from "ramda"

class AR extends MAR {
  constructor(opt = {}) {
    super({ ...opt, in_memory: true })
    this.log = opt.log === true
    this.in_memory = true
    this.mem = opt.mem ?? new ArMem()
    this.gql = new GQL({ mem: this.mem })
    this.arweave = this.mem.arweave
  }
  async owner(di) {
    const raw_owner = di.rawOwner
    const hashBuffer = Buffer.from(
      await crypto.subtle.digest("SHA-256", raw_owner),
    )
    return base64url.encode(hashBuffer)
  }
  async dataitem({ target = "", data = "1984", tags = {}, signer, item }) {
    let di = item
    if (!di) {
      const _tags = buildTags(tags)
      const _item = await signer({ data, tags: _tags, target })
      di = new DataItem(_item.raw)
    } else {
      tags = t(di.tags)
    }
    const owner = await this.owner(di)
    return { id: await di.id, owner, item: di, tags }
  }

  async post({ data = "1984", tags = {}, jwk }) {
    let err = null
    ;({ err, jwk } = await this.checkWallet({ jwk }))
    if (err) return { err }
    let tx = await this.arweave.createTransaction({ data: data })
    let _tags = buildTags(null, tags)
    for (const v of _tags) tx.addTag(v.name, v.value)
    return await this.postTx(tx, jwk)
  }

  async postItems(items, jwk) {
    let err = null
    ;({ err, jwk } = await this.checkWallet({ jwk }))
    if (err) return { err }
    if (!is(Array, items)) items = [items]
    let _items = []
    for (const di of items) {
      di._id = await di.id
      const data_size = Buffer.byteLength(di.rawData).toString()
      let data_type = ""
      for (const t of di.tags)
        if (t.name === "Content-Type") data_type = t.value
      const owner = await this.owner(di)
      await this.mem.set({ key: di.owner, address: owner }, "addrmap", owner)
      let data = di.data
      let _item = {
        _data: { size: data_size, type: data_type },
        anchor: di.anchor,
        signature: di.signature,
        recipient: di.target,
        id: await di.id,
        item: di,
        owner,
        tags: di.tags,
        data,
      }
      await this.mem.set(_item, "txs", await di.id)
      _items.push(_item)
    }
    const bundle = await bundleAndSignData(items, new ArweaveSigner(jwk))
    const tx = await this.mem.arweave.createTransaction(
      { data: bundle.binary },
      jwk,
    )
    tx.addTag("Bundle-Format", "binary")
    tx.addTag("Bundle-Version", "2.0.0")
    return await this.postTx(tx, jwk, _items)
  }

  async postTx(tx, jwk, items = []) {
    let err = null
    ;({ err, jwk } = await this.checkWallet({ jwk }))
    if (err) return { err }

    let res = null
    if (!tx.id) await this.mem.arweave.transactions.sign(tx, jwk)
    let height = (await this.mem.get("height")) + 1
    await this.mem.set(height, "height")
    let block = {
      id: tx.id,
      timestamp: Date.now(),
      height,
      previous: last(await this.mem.get("blocks")) ?? "",
      txs: [],
    }
    let msg = null
    if (items) {
      for (const item of items) {
        let _txs = item
        _txs.parent = { id: tx.id }
        _txs.bundledIn = { id: tx.id }
        _txs.anchor = ""
        const _tags = t(item.tags)
        if (
          includes(_tags.Type, [
            "Message",
            "Process",
            "Module",
            "Scheduler-Location",
            "Attestation",
            "Available",
          ])
        ) {
          msg = { id: item.id, type: _tags.Type }
          if (msg.type === "Process") msg.pid = item.recipient
        }
        let data_type = ""
        for (const v of item.item.tags) {
          if (v.name === "Content-Type") data_type = v.value
        }
        block.txs.push(item.id)
        _txs.block = block.id
        await this.mem.set(_txs, "txs", item.id)
      }
    }
    let _tags = []
    for (const v of tx.tags) {
      _tags.push({
        name: base64url.decode(v.name),
        value: base64url.decode(v.value),
      })
    }
    const __tags = t(_tags)
    if (__tags.Type === "Module") {
      await this.mem.set(
        {
          data: Buffer.from(tx.data, "base64"),
          format: __tags["Module-Format"],
        },
        "wasms",
        tx.id,
      )
    }
    tx.tags = _tags
    tx.owner = await this.arweave.wallets.jwkToAddress({ n: tx.owner })
    let _txs = tx
    block.txs.push(tx.id)
    _txs.block = block.id
    await this.mem.set(_txs, "txs", tx.id)
    let blocks = await this.mem.get("blocks")
    blocks.push(block.id)
    await this.mem.set(blocks, "blocks")
    await this.mem.set(block, "blockmap", block.id)

    if (jwk) {
      const owner = await this.arweave.wallets.jwkToAddress(jwk)
      await this.mem.set({ address: owner, key: jwk.n }, "addrmap", owner)
    }
    res = { id: tx.id, status: 200, statusText: "200" }
    if (this.log) {
      if (msg) {
        console.log(
          `New ${msg.type}:\t${msg.id}${msg.pid ? ` > ${msg.pid}` : ""}`,
        )
      } else {
        console.log(`New Post:\t${tx.id}`)
      }
    }
    return { res, err, id: tx.id }
  }

  async tx(id) {
    return await this.mem.get("txs", id)
  }

  async data(id, _string, log) {
    let decode = true
    let string = _string
    if (is(Object, _string)) {
      if (!isNil(_string.decode)) decode = _string.decode
      if (!isNil(_string.string)) string = _string.string
    }
    let tx = await this.mem.get("txs", id)
    let _data = tx?.data ?? null
    if (tx?.format === 2 && _data) {
      _data = Buffer.from(_data, "base64")
    } else if (_data) {
      _data = Buffer.from(base64url.decode(_data))
    }
    let isBuf = is(Uint8Array, _data) || is(ArrayBuffer, _data)
    let isStr = is(String, _data)
    if (decode === false) {
      if (isStr) _data = new TextEncoder().encode(_data)
      return base64url.encode(_data)
    } else {
      if (isBuf && string) {
        return _data.toString()
      } else if (isStr && string !== true) {
        return new TextEncoder().encode(_data)
      }
    }
    return _data
  }
}

export default AR
