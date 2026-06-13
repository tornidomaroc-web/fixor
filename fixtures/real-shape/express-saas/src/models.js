const { EntitySchema } = require("typeorm");

const User = new EntitySchema({
  name: "User",
  columns: {
    id: { primary: true, type: "int", generated: true },
    email: { type: "varchar" },
    accessToken: { type: "varchar" },
    role: { type: "varchar", default: "member" },
    isSuperuser: { type: "boolean", default: false },
  },
});

const Document = new EntitySchema({
  name: "Document",
  columns: {
    id: { primary: true, type: "int", generated: true },
    ownerId: { type: "int" },
    title: { type: "varchar" },
    body: { type: "text" },
  },
});

module.exports = { User, Document };
