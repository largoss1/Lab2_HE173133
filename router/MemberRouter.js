const express = require("express");
const memberController = require("../controllers/MemberController");

const router = express.Router();

router.get("/", memberController.getAllMembers);
router.get("/:id", memberController.getMemberById);
router.post("/", memberController.createMember);
router.put("/:id", memberController.updateMember);
router.delete("/:id", memberController.deleteMember);

module.exports = router;