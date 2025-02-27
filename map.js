import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
mapboxgl.accessToken = "pk.eyJ1IjoiYW1oYW0iLCJhIjoiY203ZHduY2FzMDhhbTJqbzQzN2N2eG9hZCJ9.mUY2qxz0u4hjUl3Iipar7Q";

const map = new mapboxgl.Map({
  container: "map", 
  style: "mapbox://styles/mapbox/streets-v12", 
  center: [-71.09415, 42.36027], 
  zoom: 12, 
  minZoom: 5, 
  maxZoom: 18, 
});

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

map.on("load", async () => {
  map.addSource("boston_route", {
    type: "geojson",
    data: "Existing_Bike_Network_2022.geojson",
  });
  map.addLayer({
    id: "bike-lanes",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "green",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  map.addSource("cambridge_route", {
    type: "geojson",
    data: "RECREATION_BikeFacilities.geojson",
  });
  map.addLayer({
    id: "bike-lanes2",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "red",
      "line-width": 3,
      "line-opacity": 0.4,
    },
  });

  let jsonData;
  try {
    const jsonurl = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

    const jsonData = await d3.json(jsonurl);

    console.log("Loaded JSON Data:", jsonData); 
    const svg = d3.select("#map").select("svg");

    const trips = await d3.csv("https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv", (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);

      let startedMinutes = minutesSinceMidnight(trip.started_at);
      departuresByMinute[startedMinutes].push(trip);

      let arrivalMinutes = minutesSinceMidnight(trip.ended_at);
      arrivalsByMinute[arrivalMinutes].push(trip);
      return trip;
    });

    let stations = computeStationTraffic(jsonData.data.stations);
    console.log("Stations Array:", stations);

    const tooltip = d3.select("#tooltip"); 

    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
    const circles = svg
      .selectAll("circle")
      .data(stations, (d) => d.short_name)
      .enter()
      .append("circle")
      .attr("r", (d) => radiusScale(d.totalTraffic)) 
      .attr("fill", "steelblue") 
      .attr("stroke", "white") 
      .attr("stroke-width", 1) 
      .attr("opacity", 0.8) 
      .on("mouseover", function (event, d) {
        tooltip
          .style("opacity", 0.85)
          .html(
            `<strong>${d.totalTraffic} trips</strong><br>
                ${d.departures} departures<br>
                ${d.arrivals} arrivals`
          )
          .style("left", `${event.pageX + 10}px`) 
          .style("top", `${event.pageY - 20}px`);

        d3.select(this) 
          .attr("stroke-width", 1.5)
          .attr("opacity", 1);
      })
      .on("mousemove", function (event) {
        tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
      })
      .on("mouseout", function () {
        tooltip.style("opacity", 0);
        d3.select(this) 
          .attr("stroke-width", 1)
          .attr("opacity", 0.8);
      })
      .style("--departure-ratio", (d) => stationFlow(d.departures / d.totalTraffic));

    function updatePositions() {
      circles
        .attr("cx", (d) => getCoords(d).cx) 
        .attr("cy", (d) => getCoords(d).cy);
    }

    updatePositions();

    map.on("move", updatePositions); 
    map.on("zoom", updatePositions);
    map.on("resize", updatePositions); 
    map.on("moveend", updatePositions); 

    const timeSlider = document.getElementById("time-slider");
    const selectedTime = document.getElementById("selected-time");
    const anyTimeLabel = document.getElementById("any-time");

    function updateTimeDisplay() {
      let timeFilter = Number(timeSlider.value); 

      if (timeFilter === -1) {
        selectedTime.textContent = ""; 
        anyTimeLabel.style.display = "block";
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = "none"; 
      }

      updateScatterPlot(timeFilter);
    }
    timeSlider.addEventListener("input", updateTimeDisplay);
    updateTimeDisplay();

    function updateScatterPlot(timeFilter) {
      const filteredStations = computeStationTraffic(stations, timeFilter);

      timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
      circles
        .data(filteredStations, (d) => d.short_name)
        .join("circle") 
        .attr("r", (d) => radiusScale(d.totalTraffic))
        .style("--departure-ratio", (d) => stationFlow(d.departures / d.totalTraffic));
    }
  } catch (error) {
    console.error("Error loading JSON:", error); 
  }
});

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat); 
  const { x, y } = map.project(point); 
  return { cx: x, cy: y }; 
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes); 
  return date.toLocaleString("en-US", { timeStyle: "short" }); 
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter), 
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter), 
    (v) => v.length,
    (d) => d.end_station_id
  );
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); 
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}
