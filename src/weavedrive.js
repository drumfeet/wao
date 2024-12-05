import Arweave from "arweave"
const KB = 1024
const MB = KB * 1024
const CACHE_SZ = 32 * KB
const CHUNK_SZ = 128 * MB
const NOTIFY_SZ = 512 * MB

export default class WeaveDrive {
  constructor(ar) {
    this.drive = function WeaveDrive(mod, FS) {
      return {
        reset(fd) {
          //console.log("WeaveDrive: Resetting fd: ", fd)
          FS.streams[fd].node.position = 0
          FS.streams[fd].node.cache = new Uint8Array(0)
        },

        joinUrl({ url, path }) {
          if (!path) return url
          if (path.startsWith("/"))
            return this.joinUrl({ url, path: path.slice(1) })

          url = new URL(url)
          url.pathname += path
          return url.toString()
        },

        async customFetch(path, options) {
          /**
           * mod.ARWEAVE may be a comma-delimited list of urls.
           * So we parse it into an array that we sequentially consume
           * using fetch, and return the first successful response.
           *
           * The first url is considered "primary". So if all urls fail
           * to produce a successful response, then we return the primary's
           * error response
           */
          const urlList = mod.ARWEAVE.includes(",")
            ? mod.ARWEAVE.split(",").map(url => url.trim())
            : [mod.ARWEAVE]

          let p
          for (const url of urlList) {
            const res = fetch(this.joinUrl({ url, path }), options)
            if (await res.then(r => r.ok).catch(() => false)) return res
            if (!p) p = res
          }

          /**
           * None succeeded so fallback to the primary and accept
           * whatever it returned
           */
          return p
        },

        async create(id) {
          var properties = { isDevice: false, contents: null }

          if (!(await this.checkAdmissible(id))) {
            //console.log("WeaveDrive: Arweave ID is not admissable! ", id)
            return 0
          }

          // Create the file in the emscripten FS

          // This check/mkdir was added for AOP 6 Boot loader because create is
          // called first because were only loading Data, we needed to create
          // the directory. See: https://github.com/permaweb/aos/issues/342
          if (!FS.analyzePath("/data/").exists) {
            FS.mkdir("/data/")
          }

          var node = FS.createFile("/", "data/" + id, properties, true, false)
          // Set initial parameters
          /*
      var bytesLength = await this.customFetch(`/${id}`, {
        method: "HEAD",
        }).then(res => res.headers.get("Content-Length"))
      */
          let data = await ar.data(id)
          const bytesLength = data ? new TextEncoder().encode(data).length : 100
          node.total_size = Number(bytesLength)
          node.cache = new Uint8Array(0)
          node.position = 0

          // Add a function that defers querying the file size until it is asked the first time.
          Object.defineProperties(node, {
            usedBytes: {
              get: function () {
                return bytesLength
              },
            },
          })

          // Now we have created the file in the emscripten FS, we can open it as a stream
          var stream = FS.open("/data/" + id, "r")

          //console.log("JS: Created file: ", id, " fd: ", stream.fd);
          return stream
        },
        async createBlockHeader(id) {
          const customFetch = this.customFetch
          // todo: add a bunch of retries
          async function retry(x) {
            return new Promise(r => {
              setTimeout(function () {
                r(customFetch(`/block/height/${id}`))
              }, x * 10000)
            })
          }
          var result = await this.customFetch(`/block/height/${id}`)
            .then(res => (!res.ok ? retry(1) : res))
            .then(res => (!res.ok ? retry(2) : res))
            .then(res => (!res.ok ? retry(3) : res))
            .then(res => (!res.ok ? retry(4) : res))
            .then(res => res.text())

          var bytesLength = result.length

          var node = FS.createDataFile(
            "/",
            "block/" + id,
            Buffer.from(result, "utf-8"),
            true,
            false,
          )

          var stream = FS.open("/block/" + id, "r")
          return stream
        },
        async createTxHeader(id) {
          const customFetch = this.customFetch
          async function toAddress(owner) {
            return Arweave.utils.bufferTob64Url(
              await Arweave.crypto.hash(Arweave.utils.b64UrlToBuffer(owner)),
            )
          }
          async function retry(x) {
            return new Promise(r => {
              setTimeout(function () {
                r(customFetch(`/tx/${id}`))
              }, x * 10000)
            })
          }
          // todo: add a bunch of retries
          var result = await this.customFetch(`/tx/${id}`)
            .then(res => (!res.ok ? retry(1) : res))
            .then(res => (!res.ok ? retry(2) : res))
            .then(res => (!res.ok ? retry(3) : res))
            .then(res => (!res.ok ? retry(4) : res))
            .then(res => res.json())
            .then(async entry => ({
              ...entry,
              ownerAddress: await toAddress(entry.owner),
            }))
            //.then(x => (console.error(x), x))
            .then(x => JSON.stringify(x))

          var node = FS.createDataFile(
            "/",
            "tx/" + id,
            Buffer.from(result, "utf-8"),
            true,
            false,
          )
          var stream = FS.open("/tx/" + id, "r")
          return stream
        },
        async createDataItemTxHeader(id) {
          const gqlQuery = this.gqlQuery
          var GET_TRANSACTION_QUERY = `
      query GetTransactions ($transactionIds: [ID!]!) {
        transactions(ids: $transactionIds) {
          edges {
            node {
              id
              anchor
              data {
                size
              }
              signature
              recipient 
              owner {
                address 
                key
              }
              fee {
                ar 
                winston
              }
              quantity {
                winston
                ar
              }
              tags {
                name 
                value 
              }
              bundledIn {
                id
              }
              block { 
                id
                timestamp
                height
                previous
              }
            }
          }
        }
      }`
          var variables = { transactionIds: [id] }
          async function retry(x) {
            return new Promise(r => {
              setTimeout(function () {
                r(gqlQuery(GET_TRANSACTION_QUERY, variables))
              }, x * 10000)
            })
          }

          const gqlExists = await this.gqlExists()
          if (!gqlExists) {
            return "GQL Not Found!"
          }

          // todo: add a bunch of retries
          var result = await this.gqlQuery(GET_TRANSACTION_QUERY, variables)
            .then(res => (!res.ok ? retry(1) : res))
            .then(res => (!res.ok ? retry(2) : res))
            .then(res => (!res.ok ? retry(3) : res))
            .then(res => (!res.ok ? retry(4) : res))
            .then(res => res.json())
            .then(res => {
              return res?.data?.transactions?.edges?.[0]?.node
                ? res.data.transactions.edges[0].node
                : "No results"
            })
            .then(async entry => {
              return typeof entry == "string"
                ? entry
                : {
                    format: 3,
                    ...entry,
                  }
            })
            .then(x => {
              return typeof x == "string" ? x : JSON.stringify(x)
            })

          if (result === "No results") {
            return result
          }
          FS.createDataFile(
            "/",
            "tx2/" + id,
            Buffer.from(result, "utf-8"),
            true,
            false,
          )
          var stream = FS.open("/tx2/" + id, "r")

          return stream
        },
        async open(filename) {
          const pathCategory = filename.split("/")[1]
          const id = filename.split("/")[2]
          console.log("JS: Opening ID: ", id)
          if (pathCategory === "tx") {
            FS.createPath("/", "tx", true, false)
            if (FS.analyzePath(filename).exists) {
              var stream = FS.open(filename, "r")
              if (stream.fd) return stream.fd
              return 0
            } else {
              const stream = await this.createTxHeader(id)
              return stream.fd
            }
          }
          if (pathCategory === "tx2") {
            FS.createPath("/", "tx2", true, false)
            if (FS.analyzePath(filename).exists) {
              var stream = FS.open(filename, "r")
              if (stream.fd) return stream.fd
              return 0
            } else {
              const stream = await this.createDataItemTxHeader(id)
              if (stream.fd) return stream.fd
              return 0
            }
          }
          if (pathCategory === "block") {
            FS.createPath("/", "block", true, false)
            if (FS.analyzePath(filename).exists) {
              var stream = FS.open(filename, "r")
              if (stream.fd) return stream.fd
              return 0
            } else {
              const stream = await this.createBlockHeader(id)
              return stream.fd
            }
          }
          if (pathCategory === "data") {
            if (FS.analyzePath(filename).exists) {
              var stream = FS.open(filename, "r")
              if (stream.fd) return stream.fd
              console.log("JS: File not found: ", filename)
              return 0
            } else {
              //console.log("JS: Open => Creating file: ", id);
              const stream = await this.create(id)
              //console.log("JS: Open => Created file: ", id, " fd: ", stream.fd);
              return stream.fd
            }
          } else if (pathCategory === "headers") {
            console.log("Header access not implemented yet.")
            return 0
          } else {
            console.log("JS: Invalid path category: ", pathCategory)
            return 0
          }
        },
        async read(fd, raw_dst_ptr, raw_length) {
          // Note: The length and dst_ptr are 53 bit integers in JS, so this _should_ be ok into a large memspace.
          var to_read = Number(raw_length)
          var dst_ptr = Number(raw_dst_ptr)

          var stream = 0
          for (var i = 0; i < FS.streams.length; i++) {
            if (FS.streams[i].fd === fd) {
              stream = FS.streams[i]
            }
          }
          // read block headers
          if (stream.path.includes("/block")) {
            mod.HEAP8.set(stream.node.contents.subarray(0, to_read), dst_ptr)
            return to_read
          }
          // read tx headers
          if (stream.path.includes("/tx")) {
            mod.HEAP8.set(stream.node.contents.subarray(0, to_read), dst_ptr)
            return to_read
          }
          // Satisfy what we can with the cache first
          var bytes_read = this.readFromCache(stream, dst_ptr, to_read)
          stream.position += bytes_read
          stream.lastReadPosition = stream.position
          dst_ptr += bytes_read
          to_read -= bytes_read

          // Return if we have satisfied the request
          if (to_read === 0) {
            //console.log("WeaveDrive: Satisfied request with cache. Returning...")
            return bytes_read
          }
          //console.log("WeaveDrive: Read from cache: ", bytes_read, " Remaining to read: ", to_read)

          const chunk_download_sz = Math.max(to_read, CACHE_SZ)
          const to = Math.min(
            stream.node.total_size,
            stream.position + chunk_download_sz,
          )
          //console.log("WeaveDrive: fd: ", fd, " Read length: ", to_read, " Reading ahead:", to - to_read - stream.position)

          // Fetch with streaming
          /*
      const response = await this.customFetch(`/${stream.node.name}`, {
        method: "GET",
        redirect: "follow",
        headers: { Range: `bytes=${stream.position}-${to}` },
      })

      const reader = response.body.getReader()
      */
          const data = new TextEncoder().encode(
            (await ar.data(stream.node.name)) ?? "",
          )

          // Extract the Range header to determine the start and end of the requested chunk
          const start = 0
          const end = data.length

          // Create a ReadableStream for the requested chunk
          const chunk = data.subarray(start, end)
          const response = new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(chunk) // Push the chunk to the stream
                controller.close() // Close the stream when done
              },
            }),
            {
              headers: { "Content-Length": chunk.length.toString() },
            },
          )
          const reader = response.body.getReader()
          var bytes_until_cache = CHUNK_SZ
          var bytes_until_notify = NOTIFY_SZ
          var downloaded_bytes = 0
          var cache_chunks = []

          try {
            while (true) {
              const { done, value: chunk_bytes } = await reader.read()
              if (done) break
              // Update the number of downloaded bytes to be _all_, not just the write length
              downloaded_bytes += chunk_bytes.length
              bytes_until_cache -= chunk_bytes.length
              bytes_until_notify -= chunk_bytes.length

              // Write bytes from the chunk and update the pointer if necessary
              const write_length = Math.min(chunk_bytes.length, to_read)
              if (write_length > 0) {
                //console.log("WeaveDrive: Writing: ", write_length, " bytes to: ", dst_ptr)
                mod.HEAP8.set(chunk_bytes.subarray(0, write_length), dst_ptr)
                dst_ptr += write_length
                bytes_read += write_length
                stream.position += write_length
                to_read -= write_length
              }

              if (to_read == 0) {
                // Add excess bytes to our cache
                const chunk_to_cache = chunk_bytes.subarray(write_length)
                //console.log("WeaveDrive: Cacheing excess: ", chunk_to_cache.length)
                cache_chunks.push(chunk_to_cache)
              }

              if (bytes_until_cache <= 0) {
                console.log(
                  "WeaveDrive: Chunk size reached. Compressing cache...",
                )
                stream.node.cache = this.addChunksToCache(
                  stream.node.cache,
                  cache_chunks,
                )
                cache_chunks = []
                bytes_until_cache = CHUNK_SZ
              }

              if (bytes_until_notify <= 0) {
                console.log(
                  "WeaveDrive: Downloaded: ",
                  (downloaded_bytes / stream.node.total_size) * 100,
                  "%",
                )
                bytes_until_notify = NOTIFY_SZ
              }
            }
          } catch (error) {
            console.error("WeaveDrive: Error reading the stream: ", error)
          } finally {
            reader.releaseLock()
          }
          // If we have no cache, or we have not satisfied the full request, we need to download the rest
          // Rebuild the cache from the new cache chunks
          stream.node.cache = this.addChunksToCache(
            stream.node.cache,
            cache_chunks,
          )

          // Update the last read position
          stream.lastReadPosition = stream.position
          return bytes_read
        },
        close(fd) {
          var stream = 0
          for (var i = 0; i < FS.streams.length; i++) {
            if (FS.streams[i].fd === fd) {
              stream = FS.streams[i]
            }
          }
          FS.close(stream)
        },

        // Readahead cache functions
        readFromCache(stream, dst_ptr, length) {
          // Check if the cache has been invalidated by a seek
          if (stream.lastReadPosition !== stream.position) {
            //console.log("WeaveDrive: Invalidating cache for fd: ", stream.fd, " Current pos: ", stream.position, " Last read pos: ", stream.lastReadPosition)
            stream.node.cache = new Uint8Array(0)
            return 0
          }
          // Calculate the bytes of the request that can be satisfied with the cache
          var cache_part_length = Math.min(length, stream.node.cache.length)
          var cache_part = stream.node.cache.subarray(0, cache_part_length)
          mod.HEAP8.set(cache_part, dst_ptr)
          // Set the new cache to the remainder of the unused cache and update pointers
          stream.node.cache = stream.node.cache.subarray(cache_part_length)

          return cache_part_length
        },

        addChunksToCache(old_cache, chunks) {
          // Make a new cache array of the old cache length + the sum of the chunk lengths, capped by the max cache size
          var new_cache_length = Math.min(
            old_cache.length +
              chunks.reduce((acc, chunk) => acc + chunk.length, 0),
            CACHE_SZ,
          )
          var new_cache = new Uint8Array(new_cache_length)
          // Copy the old cache to the new cache
          new_cache.set(old_cache, 0)
          // Load the cache chunks into the new cache
          var current_offset = old_cache.length
          for (let chunk of chunks) {
            if (current_offset < new_cache_length) {
              new_cache.set(
                chunk.subarray(0, new_cache_length - current_offset),
                current_offset,
              )
              current_offset += chunk.length
            }
          }
          return new_cache
        },

        // General helpder functions
        async checkAdmissible(ID) {
          if (mod.mode && mod.mode == "test") {
            // CAUTION: If the module is initiated with `mode = test` we don't check availability.
            return true
          }

          // Check if we are attempting to load the On-Boot id, if so allow it
          // this was added for AOP 6 Boot loader See: https://github.com/permaweb/aos/issues/342
          const bootTag = this.getTagValue("On-Boot", mod.spawn.tags)
          if (bootTag && bootTag === ID) return true

          // Check that this module or process set the WeaveDrive tag on spawn
          const blockHeight = mod.blockHeight
          const moduleExtensions = this.getTagValues(
            "Extension",
            mod.module.tags,
          )
          const moduleHasWeaveDrive = moduleExtensions.includes("WeaveDrive")
          const processExtensions = this.getTagValues(
            "Extension",
            mod.spawn.tags,
          )
          const processHasWeaveDrive =
            moduleHasWeaveDrive || processExtensions.includes("WeaveDrive")

          if (!processHasWeaveDrive) {
            console.log(
              "WeaveDrive: Process tried to call WeaveDrive, but extension not set!",
            )
            return false
          }

          const modes = ["Assignments", "Individual", "Library"]
          // Get the Availability-Type from the spawned process's Module or Process item
          // First check the module for its defaults
          const moduleAvailabilityType = this.getTagValue(
            "Availability-Type",
            mod.module.tags,
          )
          const moduleMode = moduleAvailabilityType
            ? moduleAvailabilityType
            : "Assignments" // Default to assignments

          // Now check the process's spawn item. These settings override Module item settings.
          const processAvailabilityType = this.getTagValue(
            "Availability-Type",
            mod.spawn.tags,
          )
          const processMode = processAvailabilityType
            ? processAvailabilityType
            : moduleMode

          if (!modes.includes(processMode)) {
            throw `Unsupported WeaveDrive mode: ${processMode}`
          }

          const attestors = this.serializeStringArr(
            [
              this.getTagValue("Scheduler", mod.spawn.tags),
              ...this.getTagValues("Attestor", mod.spawn.tags),
            ].filter(t => !!t),
          )

          // Init a set of GraphQL queries to run in order to find a valid attestation
          // Every WeaveDrive process has at least the "Assignments" availability check form.
          const assignmentsHaveID = await this.queryHasResult(
            `query {
          transactions(
            owners: ${attestors},
            block: {min: 0, max: ${blockHeight}},
            tags: [
              { name: "Type", values: ["Attestation"] },
              { name: "Message", values: ["${ID}"]}
              { name: "Data-Protocol", values: ["ao"] },
            ]
          ) 
          {
            edges {
              node {
                tags {
                  name
                  value
                }
              }
            }
          }
        }`,
          )

          if (assignmentsHaveID) {
            return true
          }

          if (processMode == "Individual") {
            const individualsHaveID = await this.queryHasResult(
              `query {
            transactions(
              owners: ${attestors},
              block: {min: 0, max: ${blockHeight}},
              tags: [
                { name: "Type", values: ["Available"]},
                { name: "ID", values: ["${ID}"]}
                { name: "Data-Protocol", values: ["WeaveDrive"] },
              ]
            ) 
            {
              edges {
                node {
                  tags {
                    name
                    value
                  }
                }
              }
            }
          }`,
            )

            if (individualsHaveID) {
              return true
            }
          }

          // Halt message processing if the process requires Library mode.
          // This should signal 'Cannot Process' to the CU, not that the message itself is
          // invalid. Subsequently, the CU should not be slashable for saying that the process
          // execution failed on this message. The CU must also not continue to execute further
          // messages on this process. Attesting to them would be slashable, as the state would
          // be incorrect.
          if (processMode == "Library") {
            throw "This WeaveDrive implementation does not support Library attestations yet!"
          }

          return false
        },

        serializeStringArr(arr = []) {
          return `[${arr.map(s => `"${s}"`).join(", ")}]`
        },

        getTagValues(key, tags) {
          var values = []
          for (i = 0; i < tags.length; i++) {
            if (tags[i].name == key) {
              values.push(tags[i].value)
            }
          }
          return values
        },

        getTagValue(key, tags) {
          const values = this.getTagValues(key, tags)
          return values.pop()
        },

        async queryHasResult(query, variables) {
          const json = await this.gqlQuery(query, variables).then(res =>
            res.json(),
          )

          return !!json?.data?.transactions?.edges?.length
        },

        async gqlExists() {
          const query = `query {
        transactions(
          first: 1
        ) {
          pageInfo {
            hasNextPage
          }
        }
      }
      `

          const gqlExists = await this.gqlQuery(query, {}).then(res => res.ok)
          return gqlExists
        },

        async gqlQuery(query, variables) {
          const options = {
            method: "POST",
            body: JSON.stringify({ query, variables }),
            headers: { "Content-Type": "application/json" },
          }

          return this.customFetch("graphql", options)
        },
      }
    }
  }
}
