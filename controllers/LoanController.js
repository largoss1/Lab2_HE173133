const mongoose = require("mongoose");
const Book = require("../models/Book");
const Loan = require("../models/Loan");
const Member = require("../models/Member");

const memberPopulation = {
  path: "member_id",
  select: "fullName email phone membershipType",
};
const bookPopulation = {
  path: "items.book_id",
  select: "title author category isbn",
};

function populateLoan(query) {
  return query.populate(memberPopulation).populate(bookPopulation);
}

function sendError(res, error) {
  const isClientError =
    error.name === "ValidationError" ||
    error.name === "CastError" ||
    error.code === 11000;
  return res
    .status(error.statusCode || (isClientError ? 400 : 500))
    .json({ message: error.message });
}

function validateBorrowRequest(memberId, items) {
  if (!mongoose.isValidObjectId(memberId)) {
    return "A valid member_id is required";
  }
  if (!Array.isArray(items) || items.length === 0) {
    return "At least one book is required";
  }
  for (const item of items) {
    if (
      !item ||
      !mongoose.isValidObjectId(item.book_id) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      return "Each item requires a valid book_id and a positive integer quantity";
    }
  }
  return null;
}

function aggregateQuantities(items) {
  const quantities = new Map();
  for (const item of items) {
    const bookId = String(item.book_id);
    quantities.set(bookId, (quantities.get(bookId) || 0) + item.quantity);
  }
  return quantities;
}

async function restoreBookCopies(books) {
  await Promise.all(
    books.map(({ bookId, quantity }) =>
      Book.updateOne({ _id: bookId }, { $inc: { availableCopies: quantity } }),
    ),
  );
}

async function reserveBookCopies(quantities) {
  const reservedBooks = [];
  try {
    for (const [bookId, quantity] of quantities) {
      const book = await Book.findOneAndUpdate(
        { _id: bookId, availableCopies: { $gte: quantity } },
        { $inc: { availableCopies: -quantity } },
        { new: true },
      );
      if (!book) {
        const exists = await Book.exists({ _id: bookId });
        const error = new Error(
          exists
            ? `Insufficient copies available for book ${bookId}`
            : `Book ${bookId} not found`,
        );
        error.statusCode = exists ? 400 : 404;
        throw error;
      }
      reservedBooks.push({ bookId, quantity });
    }
    return reservedBooks;
  } catch (error) {
    await restoreBookCopies(reservedBooks);
    throw error;
  }
}

const getAllLoans = async (req, res) => {
  try {
    const loans = await populateLoan(Loan.find());
    res.status(200).json(loans);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getLoanById = async (req, res) => {
  try {
    const loan = await populateLoan(Loan.findById(req.params.id));
    if (!loan) {
      return res.status(404).json({ message: "Loan not found" });
    }
    res.status(200).json(loan);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const getLoansByMember = async (req, res) => {
  try {
    const loans = await populateLoan(
      Loan.find({ member_id: req.params.memberId }),
    );
    res.status(200).json(loans);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const createLoan = async (req, res) => {
  const { member_id: memberId, items, dueDate } = req.body;
  const validationError = validateBorrowRequest(memberId, items);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const quantities = aggregateQuantities(items);
  let member;
  try {
    member = await Member.findById(memberId);
  } catch (error) {
    return sendError(res, error);
  }
  if (!member) {
    return res.status(404).json({ message: "Member not found" });
  }
  if (!member.isActive) {
    return res.status(400).json({ message: "Inactive members cannot borrow books" });
  }

  let reservedBooks;
  try {
    reservedBooks = await reserveBookCopies(quantities);
  } catch (error) {
    return sendError(res, error);
  }

  let loan;
  try {
    loan = await Loan.create({ member_id: memberId, items, dueDate });
  } catch (error) {
    await restoreBookCopies(reservedBooks);
    return sendError(res, error);
  }

  try {
    await loan.populate([memberPopulation, bookPopulation]);
    res.status(201).json(loan);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const returnLoan = async (req, res) => {
  try {
    const existingLoan = await Loan.findById(req.params.id);
    if (!existingLoan) {
      return res.status(404).json({ message: "Loan not found" });
    }
    if (existingLoan.status === "Returned" || existingLoan.returnDate) {
      return res.status(400).json({ message: "This loan has already been returned" });
    }

    const loan = await Loan.findOneAndUpdate(
      { _id: req.params.id, returnDate: null, status: { $ne: "Returned" } },
      { $set: { returnDate: new Date(), status: "Returned" } },
      { new: true, runValidators: true },
    );
    if (!loan) {
      return res.status(400).json({ message: "This loan has already been returned" });
    }

    const quantities = new Map();
    for (const item of loan.items) {
      const bookId = String(item.book_id);
      quantities.set(bookId, (quantities.get(bookId) || 0) + item.quantity);
    }

    const restoredBooks = [];
    try {
      for (const [bookId, quantity] of quantities) {
        const result = await Book.updateOne(
          { _id: bookId },
          { $inc: { availableCopies: quantity } },
        );
        if (result.matchedCount > 0) {
          restoredBooks.push({ bookId, quantity });
        }
      }
    } catch (error) {
      await Promise.all(
        restoredBooks.map(({ bookId, quantity }) =>
          Book.updateOne({ _id: bookId }, { $inc: { availableCopies: -quantity } }),
        ),
      );
      await Loan.updateOne(
        { _id: loan._id, status: "Returned" },
        { $set: { status: existingLoan.status, returnDate: null } },
      );
      throw error;
    }

    const populatedLoan = await populateLoan(Loan.findById(loan._id));
    res.status(200).json(populatedLoan);
  } catch (error) {
    if (!res.headersSent) {
      sendError(res, error);
    }
  }
};

module.exports = {
  getAllLoans,
  getLoanById,
  getLoansByMember,
  createLoan,
  returnLoan,
};