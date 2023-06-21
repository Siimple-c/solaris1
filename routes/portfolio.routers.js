const express = require('express');
// const slugify = require('slugify');
const {
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  getPortfolio,
} = require('../controller/portfolio.controller');

const {
  getPortfolioForm,
  getPortfolioIndex,
  getEditPortfolioForm,
  viewPortfolio,
} = require('../controller/view.portfolio');

const { restrictTo } = require('../controller/auth.controller');

const router = express.Router();

router.get(
  '/portfolio/create-portfolio',
  restrictTo('admin'),
  getPortfolioForm
);

router.get('/create-portfolio', getPortfolioForm);
router.get('/', getPortfolioIndex);
// router.get('/portfolio', getPortfolioIndex);
router.post('/create-portfolio', createPortfolio);
// router.put('/:id', updatePortfolio);
router.delete('/:id', deletePortfolio);

// Route to render the edit form
router.get('/edit-portfolio/:id', getEditPortfolioForm);

// Route to handle the update request
router.post('/update-portfolio/:id', updatePortfolio);
// View single portfolio
router.get('/view/:id', viewPortfolio);

module.exports = router;
