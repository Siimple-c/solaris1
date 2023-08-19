function renderPieChart() {
  // Get data from the server using Axios
  axios
    .get('/chart/pie-chart') // Replace with your API endpoint
    .then(response => {
      const buyPortfolioData = response.data; // Assuming you receive the buyportfolio data here

      // Extract relevant data
      const compoundingDividends = buyPortfolioData.compBalance;
      const accountBalance = buyPortfolioData.accountBalance;
      const accumulatedDividends = compoundingDividends + accountBalance;

      var options = {
        chart: {
          type: 'pie',
        },
        series: [accumulatedDividends, compoundingDividends, accountBalance],
        labels: [
          'Accumulated Dividends',
          'Compounding Dividends',
          'Account Balance',
        ],
        colors: ['#00875a', '#f89f1e', '#2401b6'], // Colors for the segments
        legend: {
          position: 'right',
          labels: {
            useSeriesColors: true, // Use the same colors as the segments
          },
        },
        dataLabels: {
          enabled: false,
        },
      };

      var chartContainer = document.querySelector('#financialOverview');

      if (
        accumulatedDividends === 0 &&
        compoundingDividends === 0 &&
        accountBalance === 0
      ) {
        // No data available, show a legend indicating "No data available yet"
        chartContainer.innerHTML = '<p>No data available yet</p>';
        chartContainer.style.textAlign = 'center';
        chartContainer.style.fontSize = '14px';
        chartContainer.style.color = '#c9c9c9';
      } else {
        // Data available, render the chart
        var chart = new ApexCharts(chartContainer, options);
        chart.render();
        console.log('Pie chart rendered successfully');
      }
    })
    .catch(error => {
      console.error('Error fetching buyportfolio data:', error);
    });
}

renderPieChart();
