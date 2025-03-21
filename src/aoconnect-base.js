import * as WarpArBundles from "warp-arbundles"
const pkg = WarpArBundles.default ?? WarpArBundles
const { DataItem } = pkg
import crypto from "crypto"
import base64url from "base64url"

import {
  tags,
  action,
  tag,
  buildTags,
  isJSON,
  jsonToStr,
  dirname,
} from "./utils.js"
import weavedrive from "./weavedrive.js"
import {
  is,
  clone,
  fromPairs,
  map,
  mergeLeft,
  isNil,
  dissoc,
  o,
  reverse,
} from "ramda"

export default ({ AR, scheduler, mu, su, cu, acc, AoLoader, ArMem } = {}) => {
  return (mem, { cache, log = false, extensions = {} } = {}) => {
    const isMem = mem?.__type__ === "mem"
    if (!isMem) {
      let args = { cache }
      if (mem?.SU_URL) {
        args = mergeLeft(mem, args)
        args.scheduler = scheduler
      }
      mem = new ArMem(args)
    }
    const ar = new AR({ mem, log })
    for (const k in extensions) extensions[k] = new extensions[k](ar).ext
    extensions.WeaveDrive = new weavedrive(ar).ext

    const transform = input => {
      const output = { Tags: [] }
      if (input.Data) output.Data = input.Data
      Object.entries(input).forEach(([key, value]) => {
        if (key !== "Data" && key !== "Tags" && typeof value === "string") {
          output.Tags.push({ name: key, value })
        }
      })
      input.Tags?.forEach(tag => {
        const tagKey = Object.keys(tag)[0]
        const tagValue = tag[tagKey]
        if (typeof tagValue === "string") {
          output.Tags.push({ name: tagKey, value: tagValue })
        }
      })

      return output
    }

    const genMsg = async (Id, p, data, Tags, from, Owner, dry = false) => {
      if (!dry) p.height += 1
      return {
        Id,
        Target: p.id,
        Owner,
        Data: data?.length ? data : "",
        "Block-Height": (await mem.get("height")).toString(),
        Timestamp: Date.now().toString(),
        Module: p.module,
        From: from,
        Cron: false,
        Tags: Tags?.length ? Tags : [],
      }
    }

    const genEnv = async ({ pid, owner = "", module = "" }) => {
      return {
        Process: {
          Id: pid,
          Tags: (await mem.getTx(pid))?.tags ?? [],
          Owner: owner,
        },
        Module: {
          Id: module,
          Tags: (await mem.getTx(module))?.tags ?? [],
        },
      }
    }
    const spawn = async (opt = {}) => {
      if (!opt.module) throw Error("module missing")
      if (!opt.scheduler) throw Error("scheduler missing")
      const { mod, wasm, format } = await mem.getWasm(opt.module, mem)
      opt.tags = buildTags(
        null,
        mergeLeft(tags(opt.tags ?? []), {
          "Data-Protocol": "ao",
          Variant: "ao.TN.1",
          Type: "Process",
          SDK: "aoconnect",
          Module: mod,
          Scheduler: opt.scheduler,
          "Content-Type": "text/plain",
          Authority: mu.addr,
        }),
      )
      let ex = false
      for (let v of opt.tags) if (v.name === "Type") ex = true
      if (!ex) opt.tags.push({ name: "Type", value: "Process" })
      if (opt.for) opt.tags.push({ name: "Pushed-For", value: opt.for })
      const {
        id,
        owner,
        item,
        tags: __tags,
      } = await ar.dataitem({
        item: opt.item,
        data: opt.data,
        signer: opt.signer,
        tags: tags(opt.tags),
      })
      opt.tags = buildTags(null, __tags)
      if (opt.item) opt.data = base64url.decode(item.data)
      await ar.postItems(item, su.jwk)
      const now = Date.now
      const t = tags(opt.tags)
      const ext = t.Extension || "WeaveDrive"
      const wdrive = extensions[ext]
      let handle = null
      try {
        handle = await AoLoader(wasm, {
          format,
          WeaveDrive: wdrive,
          spawn: item,
          module: await mem.getTx(mod),
        })
      } catch (e) {}
      if (!handle) return null
      let _module = null
      _module = { handle, id: mod }
      Date.now = now
      const _tags = tags(opt.tags)
      let res = null
      let memory = opt.memory ?? null
      let p = {
        extension: ext,
        format,
        id: id,
        epochs: [],
        handle: _module.handle,
        module: _module.id,
        hash: id,
        memory,
        owner,
        height: 0,
        results: [id],
      }
      if (memory) {
        // forking...
      } else if (_tags["On-Boot"] || true) {
        let data = ""
        if (_tags["On-Boot"] === "Data") data = opt.data ?? ""
        else data = (await mem.get("msgs", _tags["On-Boot"]))?.data ?? ""
        let msg = await genMsg(id, p, data, opt.tags, owner, mu.addr, true)
        const _env = await genEnv({
          pid: p.id,
          owner: p.owner,
          module: p.module,
        })
        res = await _module.handle(null, msg, _env)
        p.memory = res.Memory
        delete res.Memory
      } else {
        p.height += 1
      }
      const _msg = { ...o(dissoc("signer"), dissoc("memory"))(opt), res }
      await mem.set(_msg, "msgs", id)
      if (_tags["Cron-Interval"]) {
        let [num, unit] = _tags["Cron-Interval"].split("-")
        let int = 0
        switch (unit.replace(/s$/, "")) {
          case "millisecond":
            int = num
            break
          case "second":
            int = num * 1000
            break
          case "minute":
            int = num * 1000 * 60
            break
          case "hour":
            int = num * 1000 * 60 * 60
            break
          case "day":
            int = num * 1000 * 60 * 60 * 24
            break
          case "month":
            int = num * 1000 * 60 * 60 * 24 * 30
            break
          case "year":
            int = num * 1000 * 60 * 60 * 24 * 365
            break
        }
        let cronTags = []
        for (const k in _tags) {
          if (/^Cron-Tag-/.test(k)) {
            cronTags.push({ name: k.replace(/Cron-Tag-/, ""), value: _tags[k] })
          }
        }
        p.cronTags = cronTags
        p.span = int
      }
      await mem.set(p, "env", id)
      return id
    }

    function genHashChain(previousHash, previousMessageId = null) {
      const hasher = crypto.createHash("sha256")
      hasher.update(Buffer.from(previousHash, "base64"))
      if (previousMessageId) {
        hasher.update(Buffer.from(previousMessageId, "base64"))
      }
      return base64url(hasher.digest())
    }

    const assign = async opt => {
      const p = await mem.get("env", opt.process)
      if (!p || !opt.process) return null
      let _opt = await mem.get("msgs", opt.message)
      let hash = genHashChain(p.hash, opt.message)
      p.hash = hash
      opt.tags = buildTags(
        null,
        mergeLeft(tags(opt.tags ?? []), {
          Timestamp: Date.now(),
          Epoch: p.epochs.length,
          Nonce: "0",
          "Data-Protocol": "ao",
          Variant: "ao.TN.1",
          SDK: "aoconnect",
          Type: "Assignment",
          "Block-Height": await mem.get("height"),
          Process: opt.process,
          Message: opt.message,
          "Hash-Chain": hash,
        }),
      )
      p.epochs.push([opt.message])
      const { id, owner, item } = await ar.dataitem({
        data: opt.data,
        signer: opt.signer,
        tags: tags(opt.tags),
        target: opt.process,
      })
      if (opt.message_item) {
        await ar.postItems([opt.message_item, item], su.jwk)
      } else {
        await ar.postItems(item, su.jwk)
      }
      try {
        let data = _opt.data ?? ""
        let _tags = _opt.tags
        let from = _opt.from ?? opt.from ?? owner
        if (_opt.item) {
          try {
            data = base64url.decode(_opt.item.data)
            _tags = _opt.item.tags
            if (!from) {
              const raw_owner = _opt.item.rawOwner
              const hashBuffer = Buffer.from(
                await crypto.subtle.digest("SHA-256", raw_owner),
              )
              from = base64url.encode(hashBuffer)
            }
          } catch (e) {
            console.log(e)
          }
        }
        // check: is owner=mu.addr right?
        const msg = await genMsg(opt.message, p, data, _tags, from, mu.addr)
        const _env = await genEnv({
          pid: p.id,
          owner: p.owner,
          module: p.module,
        })
        if (!p.handle) {
          const { format, mod, wasm } = await mem.getWasm(p.modulea)
          const wdrive = extensions[p.extention]
          p.handle = await AoLoader(wasm, {
            format,
            WeaveDrive: wdrive,
            spawn: (await mem.getTx(p.id)).item,
            module: await mem.getTx(mod),
          })
          mem.env[opt.process].handle = p.handle
        }
        const res = await p.handle(p.memory, msg, _env)
        p.memory = res.Memory
        delete res.Memory
        p.results.push(opt.message)
        await mem.set(p, "env", opt.process)
        const _msg = { ...dissoc("signer", _opt), res }
        await mem.set(_msg, "msgs", opt.message)
        for (const v of res.Messages ?? []) {
          if (await mem.get("env", v.Target)) {
            await message({
              for: opt.message,
              process: v.Target,
              tags: v.Tags,
              data: v.Data,
              signer: mu.signer,
              from: opt.process,
            })
          }
        }
        for (const v of res.Spawns ?? []) {
          const __tags = tags(v.Tags)
          await spawn({
            for: opt.message,
            module: __tags.Module,
            scheduler,
            tags: v.Tags,
            data: v.Data,
            from: __tags["From-Process"],
            signer: mu.signer,
          })
        }
        for (const v of res.Assignments ?? []) {
          for (const v2 of v.Processes) {
            await assign({
              message: v.Message,
              process: v2,
              from: opt.process,
              signer: mu.signer,
            })
          }
        }

        return id
      } catch (e) {
        console.log(e)
      }
      return null
    }

    const message = async opt => {
      const p = await mem.get("env", opt.process)
      if (!p) return null
      let ex = false
      let id = opt?.item?.id ?? ""
      let owner = opt.owner ?? ""
      let item = opt.item
      if (!opt.item && opt.signer) {
        for (let v of opt.tags) if (v.name === "Type") ex = true
        opt.tags = buildTags(
          null,
          mergeLeft(tags(opt.tags ?? []), {
            "Data-Protocol": "ao",
            Variant: "ao.TN.1",
            Type: "Message",
            SDK: "aoconnect",
          }),
        )
        if (opt.for) {
          opt.tags.push({ name: "Pushed-For", value: opt.for })
          opt.tags.push({ name: "From-Process", value: opt.from })
          const pr = (await mem.getTx(opt.from))?.tags ?? []
          const module = tags(pr).Module
          if (module) opt.tags.push({ name: "From-Module", value: module })
        }
        ;({ item, id, owner } = await ar.dataitem({
          data: opt.data,
          signer: opt.signer,
          tags: tags(opt.tags),
          target: opt.process,
        }))
      }
      const _msg = dissoc("signer", opt)
      await mem.set(_msg, "msgs", id)
      await assign({
        message_item: item,
        message: id,
        process: opt.process,
        from: owner,
        signer: mu.signer,
      })
      return id
    }
    const result = async opt => (await mem.get("msgs", opt.message))?.res
    return {
      message,
      unmonitor: async opt => {
        const p = await mem.get("env", opt.process)
        try {
          clearInterval(p.cron)
          p.cron = null
        } catch (e) {}
      },
      monitor: async opt => {
        const p = await mem.get("env", opt.process)
        if (isNil(p.cron)) {
          p.cron = setInterval(async () => {
            await message({
              tags: p.cronTags,
              process: opt.process,
              signer: mu.signer,
              from: mu.addr,
            })
          }, p.span)
        }
      },
      spawn,
      assign,
      ar,
      result,
      results: async opt => {
        const p = await mem.get("env", opt.process)
        if (!p) return { edges: [] }
        let results = p?.results || []
        const { from = null, to = null, sort = "ASC", limit = 25 } = opt || {}

        if (sort === "DESC") results = reverse(results)
        let _res = []
        let count = 0
        let started = isNil(from)
        for (let v of results) {
          if (started) {
            _res.push({ cursor: v, node: await result({ message: v }) })
            count++
            if (!isNil(to) && v === to) break
            if (limit <= count) break
          } else if (from === v) started = true
        }
        return { edges: _res }
      },
      dryrun: async opt => {
        const p = await mem.get("env", opt.process)
        if (!p) return null
        let id = opt.id ?? ""
        let owner = opt.owner ?? ""
        if (!opt.id && opt.signer) {
          ;({ id, owner } = await ar.dataitem({ ...opt, target: opt.process }))
        }
        try {
          const msg = await genMsg(
            id,
            p,
            opt.data ?? "",
            opt.tags,
            owner,
            mu.addr,
            true,
          )
          const _env = await genEnv({
            pid: p.id,
            owner: p.owner,
            module: p.module,
          })
          function cloneMemory(memory) {
            const buffer = memory.buffer.slice(0)
            return new WebAssembly.Memory({
              initial: memory.buffer.byteLength / 65536,
              maximum: memory.maximum || undefined,
              shared: memory.shared || false,
            })
          }
          if (!p.handle) {
            const { format, mod, wasm } = await mem.getWasm(p.module)
            const wdrive = extensions[p.extention]
            p.handle = await AoLoader(wasm, {
              format,
              WeaveDrive: wdrive,
              spawn: (await mem.getTx(p.id)).item,
              module: await mem.getTx(mod),
            })
            mem.env[opt.process].handle = p.handle
          }
          const res = await p.handle(p.memory, msg, _env)
          return res
        } catch (e) {
          console.log(e)
        }
        return null
      },
      mem,
    }
  }
}
