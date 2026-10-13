const express = require("express");
const connectDB = require("./config/db");
const bookRouter = require("./router/BookRouter");
const memberRouter = require("./router/MemberRouter");
const loanRouter = require("./router/LoanRouter");

const app = express();
app.use(express.json());

app.use("/api/books", bookRouter);
app.use("/api/members", memberRouter);
app.use("/api/loans", loanRouter);

app.get("/", (req, res) => {
	res.json({ message: "Welcome to the Library API" });
});

const PORT = process.env.PORT || 9999;

if (require.main === module) {
	connectDB().then(() => {
		app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
	});
}

module.exports = app;
