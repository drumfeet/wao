import wdb from "./lua/weavedb-lite.js"
import Base from "./armem-base.js"
import db from "./lfdb.js"

export default class ArMem extends Base {
  constructor(args = {}) {
    super(args)
    this.db = db(this)
    this.initSync()
  }
  async _getWasm(file) {
    return Buffer.from(wdb, "base64")
  }
}
