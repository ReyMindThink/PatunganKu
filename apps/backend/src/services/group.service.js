import { randomInt } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../utils/httpError.js";
import { GROUP_ROLE } from "../config/constants.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  }
  return code;
}

export async function createGroup(userId, { name }) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const group = await tx.group.create({
          data: { name, code: generateCode(), createdBy: userId },
        });
        await tx.groupMember.create({
          data: { groupId: group.id, userId, role: GROUP_ROLE.OWNER },
        });
        return group;
      });
    } catch (err) {
      if (err?.code === "P2002") continue;
      throw err;
    }
  }
  throw new HttpError(500, "code-generation-failed", "Gagal membuat kode grup, coba lagi");
}

export async function joinGroup(userId, { code }) {
  const group = await prisma.group.findUnique({ where: { code } });
  if (!group) {
    throw new HttpError(404, "group-not-found", "Kode grup tidak ditemukan");
  }

  try {
    await prisma.groupMember.create({
      data: { groupId: group.id, userId, role: GROUP_ROLE.MEMBER },
    });
  } catch (err) {
    if (err?.code === "P2002") {
      throw new HttpError(409, "already-member", "Kamu sudah menjadi anggota grup ini");
    }
    throw err;
  }
  return group;
}

export async function listMyGroups(userId) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    include: { group: true },
    orderBy: { joinedAt: "desc" },
  });
  return memberships.map((m) => ({ ...m.group, role: m.role }));
}

export async function getGroup(userId, groupId) {
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!group) {
    throw new HttpError(404, "group-not-found", "Grup tidak ditemukan");
  }
  if (!group.members.some((m) => m.userId === userId)) {
    throw new HttpError(403, "forbidden", "Kamu bukan anggota grup ini");
  }
  return group;
}
