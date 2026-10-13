const express = require("express");
const loanController = require("../controllers/LoanController");

const router = express.Router();

router.get("/", loanController.getAllLoans);
router.get("/member/:memberId", loanController.getLoansByMember);
router.get("/:id", loanController.getLoanById);
router.post("/", loanController.createLoan);
router.put("/:id/return", loanController.returnLoan);

module.exports = router;