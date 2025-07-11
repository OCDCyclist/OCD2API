--
-- PostgreSQL database dump
--

-- Dumped from database version 16.3
-- Dumped by pg_dump version 16.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: cube; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS cube WITH SCHEMA public;


--
-- Name: EXTENSION cube; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION cube IS 'data type for multidimensional cubes';


--
-- Name: earthdistance; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS earthdistance WITH SCHEMA public;


--
-- Name: EXTENSION earthdistance; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION earthdistance IS 'calculate great-circle distances on the surface of the Earth';


--
-- Name: assign_tags_to_location(integer, integer, integer, text[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.assign_tags_to_location(p_riderid integer, p_locationid integer, p_assignmentid integer, p_tags text[]) RETURNS TABLE(riderid integer, locationid integer, assignmentid integer, tagid integer, tagname text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    valid_tag_ids INTEGER[];
    invalid_tags TEXT[];
    new_tag_id INTEGER;
BEGIN
    -- Validate each tag and collect valid tag IDs
    valid_tag_ids := ARRAY(SELECT t.tagid FROM tags t WHERE t.riderid = p_riderid AND t.name = ANY(p_tags));
    
    -- Check for invalid tags by comparing input tags with valid tags
    invalid_tags := ARRAY(
        SELECT unnest(p_tags)
        EXCEPT
        SELECT t.name FROM tags t WHERE t.riderid = p_riderid AND t.name = ANY(p_tags)
    );

    -- Insert each invalid tag into the Tags table for the given riderid
    IF array_length(invalid_tags, 1) IS NOT NULL THEN
        FOREACH tagname IN ARRAY invalid_tags LOOP
            INSERT INTO tags (riderid, name)
            VALUES (p_riderid, tagname)
            RETURNING tags.tagid INTO new_tag_id;
            -- Append the newly inserted tag ID to the valid_tag_ids array
            valid_tag_ids := array_append(valid_tag_ids, new_tag_id);
        END LOOP;
    END IF;

    -- Delete existing tags for the given riderid, locationid, and assignmentid.
    DELETE FROM tagassignment tad
    WHERE tad.riderid = p_riderid AND tad.locationid = p_locationid AND tad.assignmentid = p_assignmentid;

    -- Insert new tag assignments for each valid tag ID
    FOREACH new_tag_id IN ARRAY valid_tag_ids LOOP
        INSERT INTO tagassignment (assignmentid, tagid, locationid, riderid)
        VALUES (p_assignmentid, new_tag_id, p_locationid, p_riderid);
    END LOOP;

    -- Return the newly assigned riderid, locationid, assignmentid, tagid, and tagname
    RETURN QUERY
    SELECT ta.riderid, ta.locationid, ta.assignmentid, t.tagid, t.name::text
    FROM tagassignment ta
    JOIN tags t ON ta.tagid = t.tagid
    WHERE ta.riderid = p_riderid AND ta.locationid = p_locationid;
END;
$$;


ALTER FUNCTION public.assign_tags_to_location(p_riderid integer, p_locationid integer, p_assignmentid integer, p_tags text[]) OWNER TO postgres;

--
-- Name: delete_cluster(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.delete_cluster(riderid_p integer, clusterid_p integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Delete records from related tables
    DELETE FROM clusters WHERE riderid = riderid_p AND clusterid = clusterid_p;
    DELETE FROM cluster_centroids WHERE riderid = riderid_p AND clusterid = clusterid_p;
    DELETE FROM ride_clusters WHERE riderid = riderid_p AND clusterid = clusterid_p;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to delete cluster: %', SQLERRM;
END;
$$;


ALTER FUNCTION public.delete_cluster(riderid_p integer, clusterid_p integer) OWNER TO postgres;

--
-- Name: find_rider_runs(integer, integer, boolean); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.find_rider_runs(IN p_riderid integer, IN p_minimum_days integer DEFAULT 10, IN p_clear_existing boolean DEFAULT false)
    LANGUAGE plpgsql
    AS $$



DECLARE

    -- Variables for the current run

    current_run_start date;

    current_run_end date;

    run_length integer;



    -- For "1 day" runs

    prev_ride_date date;



    -- For "7 day" cumulative distance

    prev_ride_date7 date;



    -- Cursors for iteration

    rec RECORD;

BEGIN

    -- Optionally delete existing runs for this riderid

    IF p_clear_existing THEN

        DELETE FROM rideruns WHERE riderid = p_riderid;

    END IF;



    -- Find all "1 day" runs

    current_run_start := NULL;

    prev_ride_date := NULL;



    FOR rec IN 

        SELECT ride_date

        FROM cummulatives

        WHERE riderid = p_riderid

        AND moving_total_distance1 > 0 -- only days with a ride

        ORDER BY ride_date

    LOOP

        IF current_run_start IS NULL THEN

            -- Start a new run

            current_run_start := rec.ride_date;

            current_run_end := rec.ride_date;

        ELSE

            -- Check if the current day is consecutive to the previous day

            IF rec.ride_date = prev_ride_date + 1 THEN

                -- Continue the run

                current_run_end := rec.ride_date;

            ELSE

                -- Run has ended, process the previous run

                run_length := current_run_end - current_run_start + 1;

                IF run_length > p_minimum_days THEN

                    -- Insert only if the run is not already in the table

                    IF NOT EXISTS (

                        SELECT 1 FROM rideruns 

                        WHERE riderid = p_riderid 

                        AND run_type = '1 day' 

                        AND run_start_date = current_run_start 

                        AND run_end_date = current_run_end

                    ) THEN

                        INSERT INTO rideruns (riderid, run_type, run_start_date, run_end_date, run_length)

                        VALUES (p_riderid, '1 day', current_run_start, current_run_end, run_length);

                    END IF;

                END IF;

                -- Start a new run

                current_run_start := rec.ride_date;

                current_run_end := rec.ride_date;

            END IF;

        END IF;

        prev_ride_date := rec.ride_date;

    END LOOP;



    -- Final run check for "1 day"

    IF current_run_start IS NOT NULL THEN

        run_length := current_run_end - current_run_start + 1;

        IF run_length > p_minimum_days THEN

            -- Insert only if the run is not already in the table

            IF NOT EXISTS (

                SELECT 1 FROM rideruns 

                WHERE riderid = p_riderid 

                AND run_type = '1 day' 

                AND run_start_date = current_run_start 

                AND run_end_date = current_run_end

            ) THEN

                INSERT INTO rideruns (riderid, run_type, run_start_date, run_end_date, run_length)

                VALUES (p_riderid, '1 day', current_run_start, current_run_end, run_length);

            END IF;

        END IF;

    END IF;



    -- Find all "7 day" runs where cumulative distance >= 200 miles

    current_run_start := NULL;

    prev_ride_date7 := NULL;



    FOR rec IN 

        SELECT ride_date, moving_total_distance7

        FROM cummulatives

        WHERE riderid = p_riderid

        AND moving_total_distance7 >= 200 -- only periods with enough total distance

        ORDER BY ride_date

    LOOP

        IF current_run_start IS NULL THEN

            -- Start a new run

            current_run_start := rec.ride_date;

            current_run_end := rec.ride_date;

        ELSE

            -- Check if the current day is consecutive to the previous day

            IF rec.ride_date = prev_ride_date7 + 1 THEN

                -- Continue the run

                current_run_end := rec.ride_date;

            ELSE

                -- Run has ended, process the previous run

                run_length := current_run_end - current_run_start + 1;

                IF run_length > p_minimum_days THEN

                    -- Insert only if the run is not already in the table

                    IF NOT EXISTS (

                        SELECT 1 FROM rideruns 

                        WHERE riderid = p_riderid 

                        AND run_type = '7 day' 

                        AND run_start_date = current_run_start 

                        AND run_end_date = current_run_end

                    ) THEN

		                INSERT INTO rideruns (riderid, run_type, run_start_date, run_end_date, run_length)

						VALUES (p_riderid, '7 day', current_run_start, current_run_end, run_length);

                    END IF;

                END IF;

                -- Start a new run

                current_run_start := rec.ride_date;

                current_run_end := rec.ride_date;

            END IF;

        END IF;

        prev_ride_date7 := rec.ride_date;

    END LOOP;



    -- Final run check for "7 day"

    IF current_run_start IS NOT NULL THEN

        run_length := current_run_end - current_run_start + 1;

        IF run_length > p_minimum_days THEN

            -- Insert only if the run is not already in the table

			IF NOT EXISTS (

				SELECT 1 FROM rideruns 

				WHERE riderid = p_riderid 

				AND run_type = '7 day' 

				AND run_start_date = current_run_start 

				AND run_end_date = current_run_end

			) THEN

				INSERT INTO rideruns (riderid, run_type, run_start_date, run_end_date, run_length)

				VALUES (p_riderid, '7 day', current_run_start, current_run_end, run_length);

			END IF;

		END IF;

    END IF;

END;

$$;


ALTER PROCEDURE public.find_rider_runs(IN p_riderid integer, IN p_minimum_days integer, IN p_clear_existing boolean) OWNER TO postgres;

--
-- Name: get_all_rides_for_cluster(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_all_rides_for_cluster(p_riderid integer, p_clusterid integer, p_cluster integer DEFAULT NULL::integer) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, color text, clusterindex integer, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH selected_rides AS (
		SELECT
			cc.rideid
		FROM
			clusters aa INNER JOIN ride_clusters bb
			on aa.riderid = bb.riderid
			and aa.clusterid = bb.clusterid
			INNER JOIN rides cc
				ON bb.rideid = cc.rideid
		WHERE
			aa.riderid = p_riderid
			AND aa.clusterid = p_clusterid
			AND (p_cluster IS NULL OR bb.cluster = p_cluster)
			AND DATE_PART('year', cc.date) >= aa.startyear AND DATE_PART('year', cc.date) < (aa.endyear+1)
	),
    ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
            AND r.rideid IN (SELECT sr.rideid FROM selected_rides sr)
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
            rc.tag::text as cluster,
			rc.color::text as color,
			rc.cluster as clusterIndex,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
        LEFT JOIN ride_clusters rc ON a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
            AND a.rideid IN (SELECT sr.rideid FROM selected_rides sr)
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
        r.cluster,
		r.color,
		r.clusterIndex,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date desc;
END;
$$;


ALTER FUNCTION public.get_all_rides_for_cluster(p_riderid integer, p_clusterid integer, p_cluster integer) OWNER TO postgres;

--
-- Name: get_cluster_definitions_with_ride_counts(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_cluster_definitions_with_ride_counts(riderid_input integer) RETURNS TABLE(clusterid integer, startyear integer, endyear integer, clustercount integer, fields text, active boolean, cluster integer, distance numeric, speedavg numeric, elevationgain numeric, hravg numeric, powernormalized numeric, name text, color text, ride_count bigint)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH cluster_data AS (
		SELECT
			a.clusterid,
            a.startyear,
            a.endyear,
			a.clustercount,
			a.fields,
			a.active,
            b.cluster,
            b.distance,
            b.speedavg,
            b.elevationgain,
            b.hravg,
            b.powernormalized,
            b.name,
			b.color
        FROM
            clusters a inner join cluster_centroids b
			on a.clusterid = b.clusterid
        WHERE
            a.riderid = riderid_input),
    ride_data AS (
        SELECT
            aa.cluster,
            DATE_PART('year', bb.date) AS year
        FROM
            ride_clusters aa
        INNER JOIN rides bb
            ON aa.riderid = bb.riderid AND aa.rideid = bb.rideid
        WHERE
            aa.riderid = riderid_input
    ),
    ride_counts AS (
        SELECT
            c.startyear,
            c.endyear,
            c.cluster,
            COUNT(r.year) AS ride_count
        FROM
            cluster_data c
        LEFT JOIN ride_data r
            ON r.cluster = c.cluster
            AND r.year BETWEEN c.startyear AND c.endyear
        GROUP BY
            c.startyear, c.endyear, c.cluster
    )
    SELECT
		c.clusterid,
		c.startyear,
        c.endyear,
		c.clustercount,
		c.fields,
		c.active,
        c.cluster,
        c.distance,
        c.speedavg,
        c.elevationgain,
        c.hravg,
        c.powernormalized,
        c.name,
		c.color,
        COALESCE(rc.ride_count, 0) AS ride_count
    FROM
        cluster_data c
    LEFT JOIN ride_counts rc
        ON c.startyear = rc.startyear
        AND c.endyear = rc.endyear
        AND c.cluster = rc.cluster
	ORDER BY
		c.startyear,
		c.endyear,
		c.cluster;
END;
$$;


ALTER FUNCTION public.get_cluster_definitions_with_ride_counts(riderid_input integer) OWNER TO postgres;

--
-- Name: get_dates_by_year_offset(integer[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_dates_by_year_offset(year_offsets integer[]) RETURNS TABLE(computed_date date)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Create a temporary table for the year offsets
    CREATE TEMP TABLE temp_offsets (year_offset INTEGER) ON COMMIT DROP;

    -- Populate the temporary table with the array values
    INSERT INTO temp_offsets(year_offset)
    SELECT UNNEST(year_offsets);

    -- Return the calculated dates
    RETURN QUERY
    SELECT (CURRENT_DATE - make_interval(years => year_offset))::DATE
    FROM temp_offsets;
END;
$$;


ALTER FUNCTION public.get_dates_by_year_offset(year_offsets integer[]) OWNER TO postgres;

--
-- Name: get_ride_matches(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_ride_matches(p_riderid integer, p_rideid integer) RETURNS TABLE(rideid integer, type text, period integer, targetpower integer, startindex integer, actualperiod integer, maxaveragepower integer, averagepower integer, peakpower integer, averageheartrate integer, starttime timestamp without time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH ftp_value AS (
        SELECT propertyvalue::INTEGER AS ftp
        FROM riderpropertyvalues
        WHERE riderid = p_riderid AND property = 'FTP'
        ORDER BY date DESC
        LIMIT 1
    )
    SELECT 
        a.rideid,
        b.type,
        b.period,
        ROUND(ftp_value.ftp * b.targetftp / 100.0, 0)::INTEGER AS targetpower,
        b.startindex,
        b.actualperiod,
        b.maxaveragepower,
        b.averagepower,
        b.peakpower,
        b.averageheartrate,
        a.date + (b.startIndex * INTERVAL '1 second') AS startTime
   FROM
        rides a
        INNER JOIN rides_matches_new b ON a.rideid = b.rideid
        CROSS JOIN ftp_value
    WHERE 
        a.riderid = p_riderid 
        AND a.rideid = p_rideid
    ORDER BY 
        b.startindex;
END;
$$;


ALTER FUNCTION public.get_ride_matches(p_riderid integer, p_rideid integer) OWNER TO postgres;

--
-- Name: get_ride_metric_detail(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_ride_metric_detail(riderid_input integer, rideid_input integer) RETURNS TABLE(metric text, period integer, metric_value numeric, starttime timestamp without time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.metric,
        b.period,
        b.metric_value,
        a.date + (b.startIndex * INTERVAL '1 second') AS startTime
    FROM
        rides a
    INNER JOIN
        rides_metric_detail b
    ON
        a.rideid = b.rideid
    WHERE
        a.riderid = riderid_input
        AND a.rideid = rideid_input
		AND b.startIndex >= 0;
END;
$$;


ALTER FUNCTION public.get_ride_metric_detail(riderid_input integer, rideid_input integer) OWNER TO postgres;

--
-- Name: get_ride_segment_efforts(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_ride_segment_efforts(p_riderid integer, p_rideid integer) RETURNS TABLE(rideid integer, date timestamp without time zone, stravaid bigint, effortid bigint, elapsed_time integer, moving_time integer, distance double precision, starttime timestamp without time zone, endtime timestamp without time zone, average_cadence integer, average_watts integer, average_heartrate integer, max_heartrate integer, name text, climb_category integer, effort_count integer, id bigint, rank integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH ranked_efforts AS (
        SELECT 
            aa.effortid, 
            aa.segmentid, 
            aa.riderid, 
            aa.elapsed_time, 
            RANK() OVER (PARTITION BY aa.segmentid ORDER BY aa.elapsed_time ASC) AS rank
        FROM segmentsstravaefforts aa
    )
    SELECT
        a.rideid,
        a.date,
        a.stravaid,
        b.effortid,
        b.elapsed_time,
        b.moving_time,
        b.distance,
        a.date + (b.start_index * INTERVAL '1 second') AS starttime,
        a.date + (b.end_index * INTERVAL '1 second') AS endtime,
        ROUND(b.average_cadence)::INTEGER AS average_cadence,
        ROUND(b.average_watts)::INTEGER AS average_watts,
        ROUND(b.average_heartrate)::INTEGER AS average_heartrate,
        ROUND(b.max_heartrate)::INTEGER AS max_heartrate,
        c.name::text,
        c.climb_category,
        c.effort_count,
		c.id,
        r.rank::integer
    FROM rides a
    INNER JOIN segmentsstravaefforts b ON a.stravaid = b.stravaid
    LEFT OUTER JOIN segmentsstrava c ON b.segmentid = c.id AND a.riderid = c.riderid
    LEFT JOIN ranked_efforts r ON b.effortid = r.effortid
    WHERE a.riderid = p_riderid and a.rideid = p_rideid
    ORDER BY b.start_index ASC;
END;
$$;


ALTER FUNCTION public.get_ride_segment_efforts(p_riderid integer, p_rideid integer) OWNER TO postgres;

--
-- Name: get_rider_bikes(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_bikes(p_riderid integer) RETURNS TABLE(bikeid integer, bikename character varying, brand character varying, make character varying, isdefault boolean, retired boolean, stravaname character varying, stravaid character varying, rides bigint, distance numeric, hours numeric, earliest timestamp without time zone, latest timestamp without time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.bikeid,
    b.bikename,
    b.brand,
    b.make,
    CASE WHEN b.isdefault = 1 THEN true ELSE false END AS isdefault,
    CASE WHEN b.retired = 1 THEN true ELSE false END AS retired,
    b.stravaname,
    COALESCE(b.stravaid,'') as stravaid,
    COALESCE(s.rides, 0),
    Round(COALESCE(s.distance, 0),1)::numeric,
    COALESCE(ROUND(s.elapsedtime / 3600.0, 1), 0)::numeric AS hours,
    s.earliest,
    s.latest
  FROM
    bikes b
  LEFT JOIN (
    SELECT
      a.bikeid,
      COUNT(*) AS rides,
      SUM(a.distance) AS distance,
      SUM(a.elapsedtime) AS elapsedtime,
      MIN(a.date) AS earliest,
      MAX(a.date) AS latest
    FROM
      rides a
    WHERE
      a.riderid = p_riderid
    GROUP BY
      a.bikeid
  ) s ON b.bikeid = s.bikeid
  WHERE
    b.riderid = p_riderid
  ORDER BY
    b.bikename ASC;
END;
$$;


ALTER FUNCTION public.get_rider_bikes(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rider_cummulatives(integer, integer[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_cummulatives(p_riderid integer, p_years integer[] DEFAULT '{}'::integer[]) RETURNS TABLE(ride_date date, moving_total_distance1 numeric, moving_total_elevationgain1 numeric, moving_total_elapsedtime1 numeric, moving_hr_average1 numeric, moving_power_average1 numeric, moving_total_distance7 numeric, moving_total_elevationgain7 numeric, moving_total_elapsedtime7 numeric, moving_hr_average7 numeric, moving_power_average7 numeric, moving_total_distance30 numeric, moving_total_elevationgain30 numeric, moving_total_elapsedtime30 numeric, moving_hr_average30 numeric, moving_power_average30 numeric, moving_total_distance365 numeric, moving_total_elevationgain365 numeric, moving_total_elapsedtime365 numeric, moving_hr_average365 numeric, moving_power_average365 numeric, moving_total_distancealltime numeric, moving_total_elevationgainalltime numeric, moving_total_elapsedtimealltime numeric, moving_hr_averagealltime numeric, moving_power_averagealltime numeric, total_tss numeric, fatigue numeric, fitness numeric, form numeric, tss30 numeric, runconsecutivedays integer, run7days200 integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.ride_date,
        c.moving_total_distance1,
        c.moving_total_elevationgain1,
        c.moving_total_elapsedtime1,
        COALESCE(c.moving_hr_average1, 0) AS moving_hr_average1,
        COALESCE(c.moving_power_average1, 0) AS moving_power_average1,
        c.moving_total_distance7,
        c.moving_total_elevationgain7,
        c.moving_total_elapsedtime7,
        c.moving_hr_average7,
        c.moving_power_average7,
        c.moving_total_distance30,
        c.moving_total_elevationgain30,
        c.moving_total_elapsedtime30,
        c.moving_hr_average30,
        c.moving_power_average30,
        c.moving_total_distance365,
        c.moving_total_elevationgain365,
        c.moving_total_elapsedtime365,
        c.moving_hr_average365,
        c.moving_power_average365,
        c.moving_total_distancealltime,
        c.moving_total_elevationgainalltime,
        c.moving_total_elapsedtimealltime,
        c.moving_hr_averagealltime,
        c.moving_power_averagealltime,
        c.total_tss,
        c.fatigue,
        c.fitness,
        c.form,
        c.tss30,
        c.runconsecutivedays,
        c.run7days200
    FROM cummulatives c
    WHERE c.riderid = p_riderid
    AND (
        CASE WHEN array_length(p_years, 1) IS NULL THEN c.ride_date >= CURRENT_DATE - INTERVAL '1 month'
             ELSE EXTRACT(YEAR FROM c.ride_date) = ANY (p_years)
        END
    )
    ORDER BY c.ride_date DESC;
END;
$$;


ALTER FUNCTION public.get_rider_cummulatives(p_riderid integer, p_years integer[]) OWNER TO postgres;

--
-- Name: get_rider_cummulatives_recent(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_cummulatives_recent(p_riderid integer) RETURNS TABLE(ride_date date, moving_total_distance1 numeric, moving_total_elevationgain1 numeric, moving_total_elapsedtime1 numeric, moving_hr_average1 numeric, moving_power_average1 numeric, moving_total_distance7 numeric, moving_total_elevationgain7 numeric, moving_total_elapsedtime7 numeric, moving_hr_average7 numeric, moving_power_average7 numeric, moving_total_distance30 numeric, moving_total_elevationgain30 numeric, moving_total_elapsedtime30 numeric, moving_hr_average30 numeric, moving_power_average30 numeric, moving_total_distance365 numeric, moving_total_elevationgain365 numeric, moving_total_elapsedtime365 numeric, moving_hr_average365 numeric, moving_power_average365 numeric, moving_total_distancealltime numeric, moving_total_elevationgainalltime numeric, moving_total_elapsedtimealltime numeric, moving_hr_averagealltime numeric, moving_power_averagealltime numeric, total_tss numeric, fatigue numeric, fitness numeric, form numeric, tss30 numeric, runconsecutivedays integer, run7days200 integer)
    LANGUAGE plpgsql
    AS $$









BEGIN

    RETURN QUERY

    SELECT

        c.ride_date,

        c.moving_total_distance1,

        c.moving_total_elevationgain1,

        c.moving_total_elapsedtime1,

        COALESCE(c.moving_hr_average1, 0) AS moving_hr_average1,

        COALESCE(c.moving_power_average1, 0) AS moving_power_average1,

        c.moving_total_distance7,

        c.moving_total_elevationgain7,

        c.moving_total_elapsedtime7,

        c.moving_hr_average7,

        c.moving_power_average7,

        c.moving_total_distance30,

        c.moving_total_elevationgain30,

        c.moving_total_elapsedtime30,

        c.moving_hr_average30,

        c.moving_power_average30,

        c.moving_total_distance365,

        c.moving_total_elevationgain365,

        c.moving_total_elapsedtime365,

        c.moving_hr_average365,

        c.moving_power_average365,

		c.moving_total_distanceAlltime,

		c.moving_total_elevationgainAlltime,

		c.moving_total_elapsedtimeAlltime,

		c.moving_hr_averageAlltime,

		c.moving_power_averageAlltime,

        c.total_tss,

        c.fatigue,

        c.fitness,

        c.form,

        c.tss30,

		c.runconsecutivedays,

		c.run7days200

    FROM cummulatives c

    WHERE c.riderid = p_riderid

    ORDER BY c.ride_date DESC

    LIMIT 30;

END;

$$;


ALTER FUNCTION public.get_rider_cummulatives_recent(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rider_distance_milestones(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_distance_milestones(riderid_input integer) RETURNS TABLE(ride_date date, distance_miles numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  WITH thresholds AS (
    SELECT
      c.ride_date,
      moving_total_distancealltime,
      FLOOR(moving_total_distancealltime / 10000) * 10000 AS milestone
    FROM cummulatives c
    WHERE riderid = riderid_input
  ),
  filtered AS (
    SELECT DISTINCT ON (milestone)
      milestone,
      t.ride_date
    FROM thresholds t
    WHERE milestone >= 10000
    ORDER BY milestone, t.ride_date
  )
  SELECT
    f.ride_date,
    milestone AS distance_miles
  FROM filtered f
  ORDER BY distance_miles;
END;
$$;


ALTER FUNCTION public.get_rider_distance_milestones(riderid_input integer) OWNER TO postgres;

--
-- Name: get_rider_lookback_this_day(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_lookback_this_day(riderid_input integer) RETURNS TABLE(category text, rideid integer, date date, distance numeric, speedavg numeric, elapsedtime integer, elevationgain numeric, hravg integer, poweravg integer, bikeid integer, stravaid bigint, title text, comment text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH earliest AS (
    SELECT
      'Earliest' AS category,
      re.rideid,
      re.date::DATE,  -- Casting to DATE
      re.distance,
      re.speedavg,
      re.elapsedtime,
      re.elevationgain,
      re.hravg,
      re.poweravg,
      re.bikeid,
      re.stravaid,
      re.title,
      re.comment
    FROM
      public.rides re
    WHERE
      DATE(re.date) = (
        SELECT DATE(MIN(ri.date))
        FROM public.rides ri
        WHERE EXTRACT(month FROM ri.date) = EXTRACT(month FROM CURRENT_DATE)
          AND EXTRACT(day FROM ri.date) = EXTRACT(day FROM CURRENT_DATE)
          AND ri.riderid = riderid_input
      )
      AND re.riderid = riderid_input
  ),
  categorized_rides AS (
    SELECT
      CASE
        WHEN rc.date::DATE = CURRENT_DATE THEN 'today'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '1 year' THEN '1 year ago'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '2 years' THEN '2 years ago'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '5 years' THEN '5 years ago'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '10 years' THEN '10 years ago'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '15 years' THEN '15 years ago'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '20 years' THEN '20 years ago'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '25 years' THEN '25 years ago'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '30 years' THEN '30 years ago'
        WHEN rc.date::DATE = CURRENT_DATE - INTERVAL '35 years' THEN '35 years ago'
        ELSE NULL
      END AS category,
      rc.rideid,
      rc.date::DATE,  -- Casting to DATE
      rc.distance,
      rc.speedavg,
      rc.elapsedtime,
      rc.elevationgain,
      rc.hravg,
      rc.poweravg,
      rc.bikeid,
      rc.stravaid,
      rc.title,
      rc.comment
    FROM
      public.rides rc
    WHERE rc.riderid = riderid_input
  )
  -- Combine the results of both CTEs using UNION ALL
  SELECT
    el.category,
    el.rideid,
    el.date,
    el.distance,
    el.speedavg,
    el.elapsedtime,
    el.elevationgain,
    el.hravg,
    el.poweravg,
    el.bikeid,
    el.stravaid,
    el.title,
    el.comment
  FROM earliest el
  UNION ALL
  SELECT
    cl.category,
    cl.rideid,
    cl.date,
    cl.distance,
    cl.speedavg,
    cl.elapsedtime,
    cl.elevationgain,
    cl.hravg,
    cl.poweravg,
    cl.bikeid,
    cl.stravaid,
    cl.title,
    cl.comment
  FROM categorized_rides cl
  WHERE cl.category IS NOT NULL;
END;
$$;


ALTER FUNCTION public.get_rider_lookback_this_day(riderid_input integer) OWNER TO postgres;

--
-- Name: get_rider_metrics_by_month_dom(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_metrics_by_month_dom(p_riderid integer) RETURNS TABLE(riderid integer, dom integer, distancejan numeric, distancefeb numeric, distancemar numeric, distanceapr numeric, distancemay numeric, distancejun numeric, distancejul numeric, distanceaug numeric, distancesep numeric, distanceoct numeric, distancenov numeric, distancedec numeric, distance numeric, elevationgainjan numeric, elevationgainfeb numeric, elevationgainmar numeric, elevationgainapr numeric, elevationgainmay numeric, elevationgainjun numeric, elevationgainjul numeric, elevationgainaug numeric, elevationgainsep numeric, elevationgainoct numeric, elevationgainnov numeric, elevationgaindec numeric, elevationgain numeric, elapsedtimejan numeric, elapsedtimefeb numeric, elapsedtimemar numeric, elapsedtimeapr numeric, elapsedtimemay numeric, elapsedtimejun numeric, elapsedtimejul numeric, elapsedtimeaug numeric, elapsedtimesep numeric, elapsedtimeoct numeric, elapsedtimenov numeric, elapsedtimedec numeric, elapsedtime numeric, hraveragejan numeric, hraveragefeb numeric, hraveragemar numeric, hraverageapr numeric, hraveragemay numeric, hraveragejun numeric, hraveragejul numeric, hraverageaug numeric, hraveragesep numeric, hraverageoct numeric, hraveragenov numeric, hraveragedec numeric, hraverage numeric, poweraveragejan numeric, poweraveragefeb numeric, poweraveragemar numeric, poweraverageapr numeric, poweraveragemay numeric, poweraveragejun numeric, poweraveragejul numeric, poweraverageaug numeric, poweraveragesep numeric, poweraverageoct numeric, poweraveragenov numeric, poweraveragedec numeric, poweraverage numeric)
    LANGUAGE plpgsql
    AS $$

BEGIN
    RETURN QUERY
	SELECT
		mbyd.riderid,
		mbyd.dom,
		mbyd.distancejan,
		mbyd.distancefeb,
		mbyd.distancemar,
		mbyd.distanceapr,
		mbyd.distancemay,
		mbyd.distancejun,
		mbyd.distancejul,
		mbyd.distanceaug,
		mbyd.distancesep,
		mbyd.distanceoct,
		mbyd.distancenov,
		mbyd.distancedec,
		mbyd.distance,
		mbyd.elevationgainjan,
		mbyd.elevationgainfeb,
		mbyd.elevationgainmar,
		mbyd.elevationgainapr,
		mbyd.elevationgainmay,
		mbyd.elevationgainjun,
		mbyd.elevationgainjul,
		mbyd.elevationgainaug,
		mbyd.elevationgainsep,
		mbyd.elevationgainoct,
		mbyd.elevationgainnov,
		mbyd.elevationgaindec,
		mbyd.elevationgain,
		mbyd.elapsedtimejan,
		mbyd.elapsedtimefeb,
		mbyd.elapsedtimemar,
		mbyd.elapsedtimeapr,
		mbyd.elapsedtimemay,
		mbyd.elapsedtimejun,
		mbyd.elapsedtimejul,
		mbyd.elapsedtimeaug,
		mbyd.elapsedtimesep,
		mbyd.elapsedtimeoct,
		mbyd.elapsedtimenov,
		mbyd.elapsedtimedec,
		mbyd.elapsedtime,
		mbyd.hraveragejan,
		mbyd.hraveragefeb,
		mbyd.hraveragemar,
		mbyd.hraverageapr,
		mbyd.hraveragemay,
		mbyd.hraveragejun,
		mbyd.hraveragejul,
		mbyd.hraverageaug,
		mbyd.hraveragesep,
		mbyd.hraverageoct,
		mbyd.hraveragenov,
		mbyd.hraveragedec,
		mbyd.hraverage,
		mbyd.poweraveragejan,
		mbyd.poweraveragefeb,
		mbyd.poweraveragemar,
		mbyd.poweraverageapr,
		mbyd.poweraveragemay,
		mbyd.poweraveragejun,
		mbyd.poweraveragejul,
		mbyd.poweraverageaug,
		mbyd.poweraveragesep,
		mbyd.poweraverageoct,
		mbyd.poweraveragenov,
		mbyd.poweraveragedec,
		mbyd.poweraverage
	FROM metrics_by_month_dom mbyd
	WHERE mbyd.riderid = p_riderid
	ORDER BY mbyd.dom asc;
END;
$$;


ALTER FUNCTION public.get_rider_metrics_by_month_dom(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rider_metrics_by_year_dow(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_metrics_by_year_dow(p_riderid integer) RETURNS TABLE(year integer, distancemonday numeric, distancetuesday numeric, distancewednesday numeric, distancethursday numeric, distancefriday numeric, distancesaturday numeric, distancesunday numeric, distance numeric, elevationgainmonday numeric, elevationgaintuesday numeric, elevationgainwednesday numeric, elevationgainthursday numeric, elevationgainfriday numeric, elevationgainsaturday numeric, elevationgainsunday numeric, elevationgain numeric, elapsedtimemonday numeric, elapsedtimetuesday numeric, elapsedtimewednesday numeric, elapsedtimethursday numeric, elapsedtimefriday numeric, elapsedtimesaturday numeric, elapsedtimesunday numeric, elapsedtime numeric, hraveragemonday numeric, hraveragetuesday numeric, hraveragewednesday numeric, hraveragethursday numeric, hraveragefriday numeric, hraveragesaturday numeric, hraveragesunday numeric, hraverage numeric, poweraveragemonday numeric, poweraveragetuesday numeric, poweraveragewednesday numeric, poweraveragethursday numeric, poweraveragefriday numeric, poweraveragesaturday numeric, poweraveragesunday numeric, poweraverage numeric)
    LANGUAGE plpgsql
    AS $$

BEGIN
    RETURN QUERY
	SELECT
	    mbyd.year,
		mbyd.distancemonday,
		mbyd.distancetuesday,
		mbyd.distancewednesday,
		mbyd.distancethursday,
		mbyd.distancefriday,
		mbyd.distancesaturday,
		mbyd.distancesunday,
		mbyd.distance,
		mbyd.elevationgainmonday,
		mbyd.elevationgaintuesday,
		mbyd.elevationgainwednesday,
		mbyd.elevationgainthursday,
		mbyd.elevationgainfriday,
		mbyd.elevationgainsaturday,
		mbyd.elevationgainsunday,
		mbyd.elevationgain,
		mbyd.elapsedtimemonday,
		mbyd.elapsedtimetuesday,
		mbyd.elapsedtimewednesday,
		mbyd.elapsedtimethursday,
		mbyd.elapsedtimefriday,
		mbyd.elapsedtimesaturday,
		mbyd.elapsedtimesunday,
		mbyd.elapsedtime,
		mbyd.hraveragemonday,
		mbyd.hraveragetuesday,
		mbyd.hraveragewednesday,
		mbyd.hraveragethursday,
		mbyd.hraveragefriday,
		mbyd.hraveragesaturday,
		mbyd.hraveragesunday,
		mbyd.hraverage,
		mbyd.poweraveragemonday,
		mbyd.poweraveragetuesday,
		mbyd.poweraveragewednesday,
		mbyd.poweraveragethursday,
		mbyd.poweraveragefriday,
		mbyd.poweraveragesaturday,
		mbyd.poweraveragesunday,
		mbyd.poweraverage
	FROM metrics_by_year_dow mbyd
	WHERE mbyd.riderid = p_riderid
	ORDER BY mbyd.year desc;
	
END;
$$;


ALTER FUNCTION public.get_rider_metrics_by_year_dow(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rider_metrics_by_year_month(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_metrics_by_year_month(p_riderid integer) RETURNS TABLE(rideyear integer, total_distance_miles numeric, jan_distance numeric, feb_distance numeric, mar_distance numeric, apr_distance numeric, may_distance numeric, jun_distance numeric, jul_distance numeric, aug_distance numeric, sep_distance numeric, oct_distance numeric, nov_distance numeric, dec_distance numeric, total_elevationgain numeric, jan_elevationgain numeric, feb_elevationgain numeric, mar_elevationgain numeric, apr_elevationgain numeric, may_elevationgain numeric, jun_elevationgain numeric, jul_elevationgain numeric, aug_elevationgain numeric, sep_elevationgain numeric, oct_elevationgain numeric, nov_elevationgain numeric, dec_elevationgain numeric, avg_speed numeric, jan_avg_speed numeric, feb_avg_speed numeric, mar_avg_speed numeric, apr_avg_speed numeric, may_avg_speed numeric, jun_avg_speed numeric, jul_avg_speed numeric, aug_avg_speed numeric, sep_avg_speed numeric, oct_avg_speed numeric, nov_avg_speed numeric, dec_avg_speed numeric, elapsedtime_hours numeric, jan_elapsedtime_hours numeric, feb_elapsedtime_hours numeric, mar_elapsedtime_hours numeric, apr_elapsedtime_hours numeric, may_elapsedtime_hours numeric, jun_elapsedtime_hours numeric, jul_elapsedtime_hours numeric, aug_elapsedtime_hours numeric, sep_elapsedtime_hours numeric, oct_elapsedtime_hours numeric, nov_elapsedtime_hours numeric, dec_elapsedtime_hours numeric, avg_cadence numeric, jan_avg_cadence numeric, feb_avg_cadence numeric, mar_avg_cadence numeric, apr_avg_cadence numeric, may_avg_cadence numeric, jun_avg_cadence numeric, jul_avg_cadence numeric, aug_avg_cadence numeric, sep_avg_cadence numeric, oct_avg_cadence numeric, nov_avg_cadence numeric, dec_avg_cadence numeric, avg_hr numeric, jan_avg_hr numeric, feb_avg_hr numeric, mar_avg_hr numeric, apr_avg_hr numeric, may_avg_hr numeric, jun_avg_hr numeric, jul_avg_hr numeric, aug_avg_hr numeric, sep_avg_hr numeric, oct_avg_hr numeric, nov_avg_hr numeric, dec_avg_hr numeric, max_hr numeric, jan_max_hr numeric, feb_max_hr numeric, mar_max_hr numeric, apr_max_hr numeric, may_max_hr numeric, jun_max_hr numeric, jul_max_hr numeric, aug_max_hr numeric, sep_max_hr numeric, oct_max_hr numeric, nov_max_hr numeric, dec_max_hr numeric, avg_power numeric, jan_avg_power numeric, feb_avg_power numeric, mar_avg_power numeric, apr_avg_power numeric, may_avg_power numeric, jun_avg_power numeric, jul_avg_power numeric, aug_avg_power numeric, sep_avg_power numeric, oct_avg_power numeric, nov_avg_power numeric, dec_avg_power numeric, max_power numeric, jan_max_power numeric, feb_max_power numeric, mar_max_power numeric, apr_max_power numeric, may_max_power numeric, jun_max_power numeric, jul_max_power numeric, aug_max_power numeric, sep_max_power numeric, oct_max_power numeric, nov_max_power numeric, dec_max_power numeric)
    LANGUAGE plpgsql
    AS $$





BEGIN

    RETURN QUERY

SELECT

    year AS rideyear,

    ROUND(SUM(total_distance), 1) AS total_distance_miles,

    ROUND(SUM(CASE WHEN month = 1 THEN total_distance ELSE 0 END), 1) AS jan_distance,

    ROUND(SUM(CASE WHEN month = 2 THEN total_distance ELSE 0 END), 1) AS feb_distance,

    ROUND(SUM(CASE WHEN month = 3 THEN total_distance ELSE 0 END), 1) AS mar_distance,

    ROUND(SUM(CASE WHEN month = 4 THEN total_distance ELSE 0 END), 1) AS apr_distance,

    ROUND(SUM(CASE WHEN month = 5 THEN total_distance ELSE 0 END), 1) AS may_distance,

    ROUND(SUM(CASE WHEN month = 6 THEN total_distance ELSE 0 END), 1) AS jun_distance,

    ROUND(SUM(CASE WHEN month = 7 THEN total_distance ELSE 0 END), 1) AS jul_distance,

    ROUND(SUM(CASE WHEN month = 8 THEN total_distance ELSE 0 END), 1) AS aug_distance,

    ROUND(SUM(CASE WHEN month = 9 THEN total_distance ELSE 0 END), 1) AS sep_distance,

    ROUND(SUM(CASE WHEN month = 10 THEN total_distance ELSE 0 END), 1) AS oct_distance,

    ROUND(SUM(CASE WHEN month = 11 THEN total_distance ELSE 0 END), 1) AS nov_distance,

    ROUND(SUM(CASE WHEN month = 12 THEN total_distance ELSE 0 END), 1) AS dec_distance,



    -- Rounded elevation gain (0 decimal places)

    ROUND(SUM(mbym.total_elevationgain), 0) AS total_elevationgain,

    ROUND(SUM(CASE WHEN month = 1 THEN mbym.total_elevationgain ELSE 0 END), 0) AS jan_elevationgain,

    ROUND(SUM(CASE WHEN month = 2 THEN mbym.total_elevationgain ELSE 0 END), 0) AS feb_elevationgain,

    ROUND(SUM(CASE WHEN month = 3 THEN mbym.total_elevationgain ELSE 0 END), 0) AS mar_elevationgain,

    ROUND(SUM(CASE WHEN month = 4 THEN mbym.total_elevationgain ELSE 0 END), 0) AS apr_elevationgain,

    ROUND(SUM(CASE WHEN month = 5 THEN mbym.total_elevationgain ELSE 0 END), 0) AS may_elevationgain,

    ROUND(SUM(CASE WHEN month = 6 THEN mbym.total_elevationgain ELSE 0 END), 0) AS jun_elevationgain,

    ROUND(SUM(CASE WHEN month = 7 THEN mbym.total_elevationgain ELSE 0 END), 0) AS jul_elevationgain,

    ROUND(SUM(CASE WHEN month = 8 THEN mbym.total_elevationgain ELSE 0 END), 0) AS aug_elevationgain,

    ROUND(SUM(CASE WHEN month = 9 THEN mbym.total_elevationgain ELSE 0 END), 0) AS sep_elevationgain,

    ROUND(SUM(CASE WHEN month = 10 THEN mbym.total_elevationgain ELSE 0 END), 0) AS oct_elevationgain,

    ROUND(SUM(CASE WHEN month = 11 THEN mbym.total_elevationgain ELSE 0 END), 0) AS nov_elevationgain,

    ROUND(SUM(CASE WHEN month = 12 THEN mbym.total_elevationgain ELSE 0 END), 0) AS dec_elevationgain,



    -- Rounded avg_speedavg in mph (1 decimal place)

    ROUND(AVG(mbym.avg_speedavg), 1) AS avg_speed,

    ROUND(AVG(CASE WHEN month = 1 THEN avg_speedavg ELSE null END), 1) AS jan_avg_speed,

    ROUND(AVG(CASE WHEN month = 2 THEN avg_speedavg ELSE null END), 1) AS feb_avg_speed,

    ROUND(AVG(CASE WHEN month = 3 THEN avg_speedavg ELSE null END), 1) AS mar_avg_speed,

    ROUND(AVG(CASE WHEN month = 4 THEN avg_speedavg ELSE null END), 1) AS apr_avg_speed,

    ROUND(AVG(CASE WHEN month = 5 THEN avg_speedavg ELSE null END), 1) AS may_avg_speed,

    ROUND(AVG(CASE WHEN month = 6 THEN avg_speedavg ELSE null END), 1) AS jun_avg_speed,

    ROUND(AVG(CASE WHEN month = 7 THEN avg_speedavg ELSE null END), 1) AS jul_avg_speed,

    ROUND(AVG(CASE WHEN month = 8 THEN avg_speedavg ELSE null END), 1) AS aug_avg_speed,

    ROUND(AVG(CASE WHEN month = 9 THEN avg_speedavg ELSE null END), 1) AS sep_avg_speed,

    ROUND(AVG(CASE WHEN month = 10 THEN avg_speedavg ELSE null END), 1) AS oct_avg_speed,

    ROUND(AVG(CASE WHEN month = 11 THEN avg_speedavg ELSE null END), 1) AS nov_avg_speed,

    ROUND(AVG(CASE WHEN month = 12 THEN avg_speedavg ELSE null END), 1) AS dec_avg_speed,



    -- Rounded total_elapsedtime_hours (1 decimal place)

    ROUND(AVG(mbym.total_elapsedtime_hours), 1) AS elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 1 THEN total_elapsedtime_hours ELSE null END), 1) AS jan_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 2 THEN total_elapsedtime_hours ELSE null END), 1) AS feb_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 3 THEN total_elapsedtime_hours ELSE null END), 1) AS mar_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 4 THEN total_elapsedtime_hours ELSE null END), 1) AS apr_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 5 THEN total_elapsedtime_hours ELSE null END), 1) AS may_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 6 THEN total_elapsedtime_hours ELSE null END), 1) AS jun_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 7 THEN total_elapsedtime_hours ELSE null END), 1) AS jul_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 8 THEN total_elapsedtime_hours ELSE null END), 1) AS aug_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 9 THEN total_elapsedtime_hours ELSE null END), 1) AS sep_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 10 THEN total_elapsedtime_hours ELSE null END), 1) AS oct_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 11 THEN total_elapsedtime_hours ELSE null END), 1) AS nov_elapsedtime_hours,

    ROUND(AVG(CASE WHEN month = 12 THEN total_elapsedtime_hours ELSE null END), 1) AS dec_elapsedtime_hours,



    -- Rounded avg_cadence  (0 decimal place)

    ROUND(AVG(mbym.avg_cadence), 0) AS avg_cadence,

    ROUND(AVG(CASE WHEN month = 1 THEN mbym.avg_cadence ELSE null END), 0) AS jan_avg_cadence,

    ROUND(AVG(CASE WHEN month = 2 THEN mbym.avg_cadence ELSE null END), 0) AS feb_avg_cadence,

    ROUND(AVG(CASE WHEN month = 3 THEN mbym.avg_cadence ELSE null END), 0) AS mar_avg_cadence,

    ROUND(AVG(CASE WHEN month = 4 THEN mbym.avg_cadence ELSE null END), 0) AS apr_avg_cadence,

    ROUND(AVG(CASE WHEN month = 5 THEN mbym.avg_cadence ELSE null END), 0) AS may_avg_cadence,

    ROUND(AVG(CASE WHEN month = 6 THEN mbym.avg_cadence ELSE null END), 0) AS jun_avg_cadence,

    ROUND(AVG(CASE WHEN month = 7 THEN mbym.avg_cadence ELSE null END), 0) AS jul_avg_cadence,

    ROUND(AVG(CASE WHEN month = 8 THEN mbym.avg_cadence ELSE null END), 0) AS aug_avg_cadence,

    ROUND(AVG(CASE WHEN month = 9 THEN mbym.avg_cadence ELSE null END), 0) AS sep_avg_cadence,

    ROUND(AVG(CASE WHEN month = 10 THEN mbym.avg_cadence ELSE null END), 0) AS oct_avg_cadence,

    ROUND(AVG(CASE WHEN month = 11 THEN mbym.avg_cadence ELSE null END), 0) AS nov_avg_cadence,

    ROUND(AVG(CASE WHEN month = 12 THEN mbym.avg_cadence ELSE null END), 0) AS dec_avg_cadence,



    -- Rounded avg_hravg  (0 decimal place)

    ROUND(AVG(mbym.avg_hravg), 0) AS avg_hr,

    ROUND(AVG(CASE WHEN month = 1 THEN mbym.avg_hravg ELSE null END), 0) AS jan_avg_hr,

    ROUND(AVG(CASE WHEN month = 2 THEN mbym.avg_hravg ELSE null END), 0) AS feb_avg_hr,

    ROUND(AVG(CASE WHEN month = 3 THEN mbym.avg_hravg ELSE null END), 0) AS mar_avg_hr,

    ROUND(AVG(CASE WHEN month = 4 THEN mbym.avg_hravg ELSE null END), 0) AS apr_avg_hr,

    ROUND(AVG(CASE WHEN month = 5 THEN mbym.avg_hravg ELSE null END), 0) AS may_avg_hr,

    ROUND(AVG(CASE WHEN month = 6 THEN mbym.avg_hravg ELSE null END), 0) AS jun_avg_hr,

    ROUND(AVG(CASE WHEN month = 7 THEN mbym.avg_hravg ELSE null END), 0) AS jul_avg_hr,

    ROUND(AVG(CASE WHEN month = 8 THEN mbym.avg_hravg ELSE null END), 0) AS aug_avg_hr,

    ROUND(AVG(CASE WHEN month = 9 THEN mbym.avg_hravg ELSE null END), 0) AS sep_avg_hr,

    ROUND(AVG(CASE WHEN month = 10 THEN mbym.avg_hravg ELSE null END), 0) AS oct_avg_hr,

    ROUND(AVG(CASE WHEN month = 11 THEN mbym.avg_hravg ELSE null END), 0) AS nov_avg_hr,

    ROUND(AVG(CASE WHEN month = 12 THEN mbym.avg_hravg ELSE null END), 0) AS dec_avg_hr,



    -- Rounded max_hrmax  (0 decimal place)

    ROUND(MAX(mbym.max_hrmax), 0) AS max_hr,

    ROUND(MAX(CASE WHEN month = 1 THEN mbym.max_hrmax ELSE null END), 0) AS jan_max_hr,

    ROUND(MAX(CASE WHEN month = 2 THEN mbym.max_hrmax ELSE null END), 0) AS feb_max_hr,

    ROUND(MAX(CASE WHEN month = 3 THEN mbym.max_hrmax ELSE null END), 0) AS mar_max_hr,

    ROUND(MAX(CASE WHEN month = 4 THEN mbym.max_hrmax ELSE null END), 0) AS apr_max_hr,

    ROUND(MAX(CASE WHEN month = 5 THEN mbym.max_hrmax ELSE null END), 0) AS may_max_hr,

    ROUND(MAX(CASE WHEN month = 6 THEN mbym.max_hrmax ELSE null END), 0) AS jun_max_hr,

    ROUND(MAX(CASE WHEN month = 7 THEN mbym.max_hrmax ELSE null END), 0) AS jul_max_hr,

    ROUND(MAX(CASE WHEN month = 8 THEN mbym.max_hrmax ELSE null END), 0) AS aug_max_hr,

    ROUND(MAX(CASE WHEN month = 9 THEN mbym.max_hrmax ELSE null END), 0) AS sep_max_hr,

    ROUND(MAX(CASE WHEN month = 10 THEN mbym.max_hrmax ELSE null END), 0) AS oct_max_hr,

    ROUND(MAX(CASE WHEN month = 11 THEN mbym.max_hrmax ELSE null END), 0) AS nov_max_hr,

    ROUND(MAX(CASE WHEN month = 12 THEN mbym.max_hrmax ELSE null END), 0) AS dec_max_hr,



    -- Rounded avg_poweravg  (0 decimal place)

    ROUND(AVG(mbym.avg_poweravg), 0) AS avg_power,

    ROUND(AVG(CASE WHEN month = 1 THEN mbym.avg_poweravg ELSE null END), 0) AS jan_avg_power,

    ROUND(AVG(CASE WHEN month = 2 THEN mbym.avg_poweravg ELSE null END), 0) AS feb_avg_power,

    ROUND(AVG(CASE WHEN month = 3 THEN mbym.avg_poweravg ELSE null END), 0) AS mar_avg_power,

    ROUND(AVG(CASE WHEN month = 4 THEN mbym.avg_poweravg ELSE null END), 0) AS apr_avg_power,

    ROUND(AVG(CASE WHEN month = 5 THEN mbym.avg_poweravg ELSE null END), 0) AS may_avg_power,

    ROUND(AVG(CASE WHEN month = 6 THEN mbym.avg_poweravg ELSE null END), 0) AS jun_avg_power,

    ROUND(AVG(CASE WHEN month = 7 THEN mbym.avg_poweravg ELSE null END), 0) AS jul_avg_power,

    ROUND(AVG(CASE WHEN month = 8 THEN mbym.avg_poweravg ELSE null END), 0) AS aug_avg_power,

    ROUND(AVG(CASE WHEN month = 9 THEN mbym.avg_poweravg ELSE null END), 0) AS sep_avg_power,

    ROUND(AVG(CASE WHEN month = 10 THEN mbym.avg_poweravg ELSE null END), 0) AS oct_avg_power,

    ROUND(AVG(CASE WHEN month = 11 THEN mbym.avg_poweravg ELSE null END), 0) AS nov_avg_power,

    ROUND(AVG(CASE WHEN month = 12 THEN mbym.avg_poweravg ELSE null END), 0) AS dec_avg_power,



    -- Rounded max_power  (0 decimal place)

    ROUND(MAX(mbym.max_powermax), 0) AS max_hr,

    ROUND(MAX(CASE WHEN month = 1 THEN mbym.max_powermax ELSE null END), 0) AS jan_max_power,

    ROUND(MAX(CASE WHEN month = 2 THEN mbym.max_powermax ELSE null END), 0) AS feb_max_power,

    ROUND(MAX(CASE WHEN month = 3 THEN mbym.max_powermax ELSE null END), 0) AS mar_max_power,

    ROUND(MAX(CASE WHEN month = 4 THEN mbym.max_powermax ELSE null END), 0) AS apr_max_power,

    ROUND(MAX(CASE WHEN month = 5 THEN mbym.max_powermax ELSE null END), 0) AS may_max_power,

    ROUND(MAX(CASE WHEN month = 6 THEN mbym.max_powermax ELSE null END), 0) AS jun_max_power,

    ROUND(MAX(CASE WHEN month = 7 THEN mbym.max_powermax ELSE null END), 0) AS jul_max_power,

    ROUND(MAX(CASE WHEN month = 8 THEN mbym.max_powermax ELSE null END), 0) AS aug_max_power,

    ROUND(MAX(CASE WHEN month = 9 THEN mbym.max_powermax ELSE null END), 0) AS sep_max_power,

    ROUND(MAX(CASE WHEN month = 10 THEN mbym.max_powermax ELSE null END), 0) AS oct_max_power,

    ROUND(MAX(CASE WHEN month = 11 THEN mbym.max_powermax ELSE null END), 0) AS nov_max_power,

    ROUND(MAX(CASE WHEN month = 12 THEN mbym.max_powermax ELSE null END), 0) AS dec_max_power

FROM metrics_by_year_month mbym

WHERE riderid = 1

GROUP BY year

ORDER BY rideyear desc;



END;

$$;


ALTER FUNCTION public.get_rider_metrics_by_year_month(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rider_reference_powerlevels(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_reference_powerlevels(p_riderid integer) RETURNS TABLE(level text, rank integer, sec0005 numeric, sec0060 numeric, sec0300 numeric, sec1200 numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.level::TEXT,
    a.rank,
    a.sec0005::NUMERIC,
    a.sec0060::NUMERIC,
    a.sec0300::NUMERIC,
    a.sec1200::NUMERIC
  FROM
    reference_powerlevels_summary a
  INNER JOIN (
    SELECT
      propertyvaluestring AS gender
    FROM
      riderpropertyvalues
    WHERE
      riderid = p_riderid
      AND property = 'Gender'
    ORDER BY
      date DESC
    LIMIT 1
  ) b ON a.gender = b.gender;
END;
$$;


ALTER FUNCTION public.get_rider_reference_powerlevels(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rider_streaks_1_day(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_streaks_1_day(p_riderid integer) RETURNS TABLE(start_date timestamp without time zone, end_date timestamp without time zone, streak_length integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH Streaks AS (
    SELECT
      ride_date::timestamp AS ride_date,
      moving_total_distance1,
      runconsecutivedays,
      (ride_date::timestamp - (runconsecutivedays - 1) * interval '1 day') AS start_date
    FROM
      cummulatives
    WHERE
      riderid = p_riderid
      AND moving_total_distance1 > 0
  ),
  RankedStreaks AS (
    SELECT
      s.start_date,
      MAX(ride_date::timestamp) AS end_date,
      MAX(runconsecutivedays) AS streak_length
    FROM
      Streaks s
    WHERE
      runconsecutivedays >= 10
    GROUP BY
      s.start_date
  )
  SELECT
    r.start_date,
    r.end_date,
    r.streak_length
  FROM
    RankedStreaks r
  ORDER BY
    r.streak_length DESC
  LIMIT 20;
END;
$$;


ALTER FUNCTION public.get_rider_streaks_1_day(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rider_streaks_7_day(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_streaks_7_day(p_riderid integer) RETURNS TABLE(start_date timestamp without time zone, end_date timestamp without time zone, streak_length integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH Streaks AS (
    SELECT
      ride_date::timestamp AS ride_date,
      moving_total_distance7,
      run7days200,
      (ride_date::timestamp - (run7days200 - 1) * interval '1 day') AS start_date
    FROM
      cummulatives
    WHERE
      riderid = p_riderid
      AND moving_total_distance7 > 0
  ),
  RankedStreaks AS (
    SELECT
      s.start_date,
      MAX(ride_date::timestamp) AS end_date,
      MAX(run7days200) AS streak_length
    FROM
      Streaks s
    WHERE
      run7days200 >= 10
    GROUP BY
      s.start_date
  )
  SELECT
    r.start_date,
    r.end_date,
    r.streak_length
  FROM
    RankedStreaks r
  ORDER BY
    r.streak_length DESC
  LIMIT 20;
END;
$$;


ALTER FUNCTION public.get_rider_streaks_7_day(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rider_trainer_distance_summary(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rider_trainer_distance_summary(riderid_input integer) RETURNS TABLE(year integer, distance_outdoor numeric, distance_indoor numeric, total_distance numeric, pct_outdoor numeric, pct_indoor numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        CAST(EXTRACT(YEAR FROM date) AS INT) AS year,
        COALESCE(SUM(distance) FILTER (WHERE trainer = 0), 0) AS distance_outdoor,
        COALESCE(SUM(distance) FILTER (WHERE trainer = 1), 0) AS distance_indoor,
        COALESCE(SUM(distance), 0) AS total_distance,
        ROUND(
            100.0 * COALESCE(SUM(distance) FILTER (WHERE trainer = 0), 0) /
            NULLIF(COALESCE(SUM(distance), 0), 0), 1
        ) AS pct_outdoor,
        ROUND(
            100.0 * COALESCE(SUM(distance) FILTER (WHERE trainer = 1), 0) /
            NULLIF(COALESCE(SUM(distance), 0), 0), 1
        ) AS pct_indoor
    FROM
        rides
    WHERE
        rides.riderid = riderid_input
    GROUP BY
        CAST(EXTRACT(YEAR FROM date) AS INT)
    ORDER BY
        year;
END;
$$;


ALTER FUNCTION public.get_rider_trainer_distance_summary(riderid_input integer) OWNER TO postgres;

--
-- Name: get_riderweight_by_daterange(integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_riderweight_by_daterange(p_riderid integer, p_daterange text) RETURNS TABLE(date timestamp without time zone, weight real, weight7 real, weight30 real, weight365 real, bodyfatfraction real, bodyfatfraction7 real, bodyfatfraction30 real, bodyfatfraction365 real, bodyh2ofraction real, bodyh2ofraction7 real, bodyh2ofraction30 real, bodyh2ofraction365 real)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rw.date,
        rw.weight,
        rw.weight7,
        rw.weight30,
        rw.weight365,
        rw.bodyfatfraction,
        rw.bodyfatfraction7,
        rw.bodyfatfraction30,
        rw.bodyfatfraction365,
        rw.bodyh2ofraction,
        rw.bodyh2ofraction7,
        rw.bodyh2ofraction30,
        rw.bodyh2ofraction365
    FROM riderweight rw
    WHERE rw.riderid = p_riderid
    AND (
        (p_daterange = 'week' AND rw.date >= NOW() - INTERVAL '7 days') OR
        (p_daterange = 'month' AND rw.date >= NOW() - INTERVAL '1 month') OR
        (p_daterange = 'year1' AND rw.date >= NOW() - INTERVAL '1 year') OR
        (p_daterange = 'year5' AND rw.date >= NOW() - INTERVAL '5 years') OR
        (p_daterange = 'year10' AND rw.date >= NOW() - INTERVAL '10 years') OR
        (p_daterange = 'all')
    )
    ORDER BY rw.date ASC;
END;
$$;


ALTER FUNCTION public.get_riderweight_by_daterange(p_riderid integer, p_daterange text) OWNER TO postgres;

--
-- Name: get_rides30days(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides30days(p_riderid integer) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
            AND r.date >= date_trunc('day', NOW() - INTERVAL '1 month')
            AND r.date < date_trunc('day', NOW() + INTERVAL '1 day')
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
			rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
		LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
	
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
            AND a.date >= date_trunc('day', NOW() - INTERVAL '30 days')
            AND a.date < date_trunc('day', NOW() + INTERVAL '1 day')
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
		r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date DESC;
END;
$$;


ALTER FUNCTION public.get_rides30days(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rides_by_date(integer, timestamp without time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_by_date(p_riderid integer, p_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
			AND DATE(r.date) = p_date
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
			rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
		LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
		LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
			AND DATE(a.date) = p_date
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
		r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date asc;
END;
$$;


ALTER FUNCTION public.get_rides_by_date(p_riderid integer, p_date timestamp without time zone) OWNER TO postgres;

--
-- Name: get_rides_by_date_range(integer, timestamp without time zone, timestamp without time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_by_date_range(p_riderid integer, p_date_start timestamp without time zone, p_date_end timestamp without time zone) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
            AND DATE(r.date) BETWEEN DATE(p_date_start) AND DATE(p_date_end)
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
            rc.tag::text as cluster,
            a.hrzones,
            a.powerzones,
            a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
        LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
            AND DATE(a.date) BETWEEN DATE(p_date_start) AND DATE(p_date_end)
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
        r.cluster,
        r.hrzones,
        r.powerzones,
        r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date DESC;
END;
$$;


ALTER FUNCTION public.get_rides_by_date_range(p_riderid integer, p_date_start timestamp without time zone, p_date_end timestamp without time zone) OWNER TO postgres;

--
-- Name: get_rides_by_dom_month(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_by_dom_month(p_riderid integer, p_dom integer, p_month integer) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
			AND date_part('day',r.date) = p_dom
			AND date_part('month',r.date) = p_month
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
			rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
		LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
			AND date_part('day',a.date) = p_dom
			AND date_part('month',a.date) = p_month
	)
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
		r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date asc;
END;
$$;


ALTER FUNCTION public.get_rides_by_dom_month(p_riderid integer, p_dom integer, p_month integer) OWNER TO postgres;

--
-- Name: get_rides_by_rideid(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_by_rideid(p_riderid integer, p_rideid integer) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
            AND r.rideid = p_rideid
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
			rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
		LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
	
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
            AND a.rideid = p_rideid
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
		r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date DESC;
END;
$$;


ALTER FUNCTION public.get_rides_by_rideid(p_riderid integer, p_rideid integer) OWNER TO postgres;

--
-- Name: get_rides_by_year_dow(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_by_year_dow(p_riderid integer, p_year integer, p_dow integer) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
			AND date_part('year',r.date) = p_year
			AND (p_dow >= 7 OR date_part('dow', r.date) = p_dow)

        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
			rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
		LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
			AND date_part('year',a.date) = p_year
			AND (p_dow >= 7 OR date_part('dow', a.date) = p_dow)
	)
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
		r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date asc;
END;
$$;


ALTER FUNCTION public.get_rides_by_year_dow(p_riderid integer, p_year integer, p_dow integer) OWNER TO postgres;

--
-- Name: get_rides_by_year_month(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_by_year_month(p_riderid integer, p_year integer, p_month integer) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
			AND date_part('year',r.date) = p_year
			AND (p_month = 0 OR date_part('month', r.date) = p_month)
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
			rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
		LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
			AND date_part('year',a.date) = p_year
			AND (p_month = 0 OR date_part('month', a.date) = p_month)
	)
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
		r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date asc;
END;
$$;


ALTER FUNCTION public.get_rides_by_year_month(p_riderid integer, p_year integer, p_month integer) OWNER TO postgres;

--
-- Name: get_rides_by_year_trainer(integer, integer, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_by_year_trainer(p_riderid integer, p_year integer, p_trainer boolean) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
			AND date_part('year',r.date) = p_year
			AND r.trainer = CASE WHEN p_trainer THEN 1 ELSE 0 END

        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
			rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
		LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
			AND date_part('year',a.date) = p_year
			AND a.trainer = CASE WHEN p_trainer THEN 1 ELSE 0 END
	)
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
		r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date asc;
END;
$$;


ALTER FUNCTION public.get_rides_by_year_trainer(p_riderid integer, p_year integer, p_trainer boolean) OWNER TO postgres;

--
-- Name: get_rides_by_years(integer, integer[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_by_years(p_riderid integer, p_years integer[]) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
            AND EXTRACT(YEAR FROM r.date) = ANY(p_years)
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
            rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
        LEFT JOIN ride_clusters rc ON a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
            AND EXTRACT(YEAR FROM a.date) = ANY(p_years)
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
        r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date DESC;
END;
$$;


ALTER FUNCTION public.get_rides_by_years(p_riderid integer, p_years integer[]) OWNER TO postgres;

--
-- Name: get_rides_lookback_this_day(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_lookback_this_day(p_riderid integer) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, category text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
            AND r.date >= date_trunc('day', NOW() - INTERVAL '30 days')
            AND r.date < date_trunc('day', NOW() + INTERVAL '1 day')
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
			rc.tag::text as cluster,
			CASE
				WHEN a.date::DATE = CURRENT_DATE THEN 'today'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '1 year' THEN '1 year ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '2 years' THEN '2 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '5 years' THEN '5 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '10 years' THEN '10 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '15 years' THEN '15 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '20 years' THEN '20 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '25 years' THEN '25 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '30 years' THEN '30 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '35 years' THEN '35 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '40 years' THEN '40 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '45 years' THEN '45 years ago'
				WHEN a.date::DATE = CURRENT_DATE - INTERVAL '50 years' THEN '50 years ago'
			ELSE NULL
			END AS category,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
		LEFT JOIN ride_clusters rc on a.rideid = rc.rideid
	
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
            AND a.date::DATE IN (
				Select computed_date from get_dates_by_year_offset(ARRAY[0, 1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50])
			)
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
		r.cluster,
		r.category,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent (closest preceding) weight for each ride
    ORDER BY r.date DESC;
END;
$$;


ALTER FUNCTION public.get_rides_lookback_this_day(p_riderid integer) OWNER TO postgres;

--
-- Name: get_rides_search(integer, date, date, numeric, numeric, numeric, numeric, integer, integer, numeric, numeric, integer, integer, integer, integer, real, real, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_rides_search(p_riderid integer, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date, p_min_distance numeric DEFAULT NULL::numeric, p_max_distance numeric DEFAULT NULL::numeric, p_min_speed numeric DEFAULT NULL::numeric, p_max_speed numeric DEFAULT NULL::numeric, p_min_hravg integer DEFAULT NULL::integer, p_max_hravg integer DEFAULT NULL::integer, p_min_elevation numeric DEFAULT NULL::numeric, p_max_elevation numeric DEFAULT NULL::numeric, p_min_elapsed_time integer DEFAULT NULL::integer, p_max_elapsed_time integer DEFAULT NULL::integer, p_min_powernormalized integer DEFAULT NULL::integer, p_max_powernormalized integer DEFAULT NULL::integer, p_min_weight_kg real DEFAULT NULL::real, p_max_weight_kg real DEFAULT NULL::real, p_keyword text DEFAULT NULL::text) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::text as bikename,
            COALESCE(b.stravaname, 'no bike')::text as stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::real AS weight_lbs,
            rc.tag::text as cluster,
			a.hrzones,
			a.powerzones,
			a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM
            rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
        LEFT JOIN ride_clusters rc ON a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date
        WHERE a.riderid = p_riderid
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::real AS calculated_weight_kg,
        r.cluster,
		r.hrzones,
		r.powerzones,
		r.cadencezones
    FROM
        ride_with_weight r
    WHERE r.weight_rank = 1
        AND (p_start_date IS NULL OR r.date::DATE >= p_start_date)
        AND (p_end_date IS NULL OR r.date::DATE <= p_end_date)
        AND (p_min_distance IS NULL OR r.distance >= p_min_distance)
        AND (p_max_distance IS NULL OR r.distance <= p_max_distance)
        AND (p_min_speed IS NULL OR r.speedavg >= p_min_speed)
        AND (p_max_speed IS NULL OR r.speedavg <= p_max_speed)
        AND (p_min_hravg IS NULL OR r.hravg >= p_min_hravg)
        AND (p_max_hravg IS NULL OR r.hravg <= p_max_hravg)
        AND (p_min_elevation IS NULL OR r.elevationgain >= p_min_elevation)
        AND (p_max_elevation IS NULL OR r.elevationgain <= p_max_elevation)
        AND (p_min_elapsed_time IS NULL OR r.elapsedtime >= p_min_elapsed_time)
        AND (p_max_elapsed_time IS NULL OR r.elapsedtime <= p_max_elapsed_time)
        AND (p_min_powernormalized IS NULL OR r.powernormalized >= p_min_powernormalized)
        AND (p_max_powernormalized IS NULL OR r.powernormalized <= p_max_powernormalized)
        AND (p_min_weight_kg IS NULL OR COALESCE(r.weight_lbs / 2.20462, 0.0) >= p_min_weight_kg)
        AND (p_max_weight_kg IS NULL OR COALESCE(r.weight_lbs / 2.20462, 0.0) <= p_max_weight_kg)
        AND (p_keyword IS NULL OR (
            r.title ILIKE '%' || p_keyword || '%'
            OR r.comment ILIKE '%' || p_keyword || '%'
            OR r.tags ILIKE '%' || p_keyword || '%'
            OR r.cluster ILIKE '%' || p_keyword || '%'))
    ORDER BY r.date ASC;
END;
$$;


ALTER FUNCTION public.get_rides_search(p_riderid integer, p_start_date date, p_end_date date, p_min_distance numeric, p_max_distance numeric, p_min_speed numeric, p_max_speed numeric, p_min_hravg integer, p_max_hravg integer, p_min_elevation numeric, p_max_elevation numeric, p_min_elapsed_time integer, p_max_elapsed_time integer, p_min_powernormalized integer, p_max_powernormalized integer, p_min_weight_kg real, p_max_weight_kg real, p_keyword text) OWNER TO postgres;

--
-- Name: get_segment_effort_rank(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_segment_effort_rank(p_riderid integer, p_segmentid integer) RETURNS TABLE(rank bigint, id bigint, strava_rideid bigint, strava_effortid bigint, segment_name text, distance numeric, total_elevation_gain numeric, start_date timestamp without time zone, elapsed_time integer, moving_time integer, average_cadence integer, average_watts integer, average_heartrate integer, max_heartrate integer, start_index integer, end_index integer, tags text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH segment_tags AS (
        SELECT 
            seg.effortid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM segmentsstravaefforts seg
        LEFT JOIN tagassignment ta ON ta.assignmentid = seg.effortid 
                                    AND ta.locationid = 3 
                                    AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE seg.riderid = p_riderid
        GROUP BY seg.effortid
    )
    SELECT 
        RANK() OVER (ORDER BY b.elapsed_time ASC) AS rank,
		a.id,
		b.stravaid AS strava_rideid,
		b.effortid AS strava_effortid,
        a.name::text AS segment_name,
        a.distance::numeric,
		a.total_elevation_gain::numeric,
        b.start_date,
        b.elapsed_time,
        b.moving_time,
        COALESCE(b.average_cadence, 0) AS average_cadence,
        COALESCE(b.average_watts, 0) AS average_watts,
        COALESCE(b.average_heartrate, 0) AS average_heartrate,
        COALESCE(b.max_heartrate, 0) AS max_heartrate,
        b.start_index,
        b.end_index,
        st.tags
    FROM 
        segmentsstrava a
    INNER JOIN 
        segmentsstravaefforts b
    ON 
        a.riderid = b.riderid
        AND a.id = b.segmentid
    LEFT JOIN segment_tags st ON b.effortid = st.effortid

	WHERE
        a.riderid = p_riderid
        AND a.id = p_segmentid
    ORDER BY 
        b.elapsed_time ASC;
END;
$$;


ALTER FUNCTION public.get_segment_effort_rank(p_riderid integer, p_segmentid integer) OWNER TO postgres;

--
-- Name: get_segmentsstrava_data_withtags(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_segmentsstrava_data_withtags(p_riderid integer) RETURNS TABLE(id bigint, name character varying, distance double precision, average_grade double precision, maximum_grade double precision, elevation_high double precision, elevation_low double precision, climb_category integer, total_elevation_gain double precision, effort_count integer, total_effort_count integer, athlete_count integer, total_elevation_loss double precision, starred_date timestamp without time zone, pr_time integer, pr_date timestamp without time zone, tags text)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH segment_tags AS (
        SELECT 
            seg.id,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM segmentsstrava seg
        LEFT JOIN tagassignment ta ON ta.assignmentid = seg.id 
                                    AND ta.locationid = 1 
                                    AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE seg.riderid = p_riderid
        GROUP BY seg.id
    )
    SELECT 
        seg.id,
        seg.name,
        seg.distance,
        seg.average_grade,
        seg.maximum_grade,
        seg.elevation_high,
        seg.elevation_low,
        seg.climb_category,
        seg.total_elevation_gain,
        seg.effort_count,
        seg.total_effort_count,
        seg.athlete_count,
        seg.total_elevation_loss,
        seg.starred_date,
        seg.pr_time,
        seg.pr_date,
        st.tags
    FROM segmentsstrava seg
    LEFT JOIN segment_tags st ON seg.id = st.id
    WHERE seg.riderid = p_riderid and seg.enabled = true
    ORDER BY seg.name;
END;
$$;


ALTER FUNCTION public.get_segmentsstrava_data_withtags(p_riderid integer) OWNER TO postgres;

--
-- Name: get_similar_ride_efforts(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_similar_ride_efforts(p_riderid integer, p_rideid integer) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, color text, clusterindex integer, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY 
    WITH similar_rides AS (
        SELECT 
            a.rideid
        FROM
			get_similar_rideid_efforts($1, $2) a
    ),
    ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
            AND r.rideid IN (SELECT sr.rideid FROM similar_rides sr)
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::TEXT AS bikename,
            COALESCE(b.stravaname, 'no bike')::TEXT AS stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::REAL AS weight_lbs,
            rc.tag::TEXT AS cluster,
            rc.color::TEXT AS color,
            rc.cluster AS clusterIndex,
            a.hrzones,
            a.powerzones,
            a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
        LEFT JOIN ride_clusters rc ON a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
            AND a.rideid IN (SELECT sr.rideid FROM similar_rides sr)
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::REAL AS calculated_weight_kg,  -- Convert lbs to kg
        r.cluster,
        r.color,
        r.clusterIndex,
        r.hrzones,
        r.powerzones,
        r.cadencezones
    FROM ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent weight for each ride
    ORDER BY r.date DESC;
END;
$_$;


ALTER FUNCTION public.get_similar_ride_efforts(p_riderid integer, p_rideid integer) OWNER TO postgres;

--
-- Name: get_similar_ride_routes(integer, integer, double precision, double precision); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_similar_ride_routes(p_riderid integer, p_rideid integer, p_distance_threshold double precision DEFAULT 5, p_geo_threshold double precision DEFAULT 1) RETURNS TABLE(rideid integer, date timestamp without time zone, distance numeric, speedavg numeric, speedmax numeric, cadence numeric, hravg integer, hrmax integer, title text, poweravg integer, powermax integer, bikeid integer, bikename text, stravaname text, stravaid bigint, comment text, elevationgain numeric, elapsedtime integer, powernormalized integer, intensityfactor numeric, tss integer, matches smallint, trainer smallint, elevationloss numeric, datenotime timestamp without time zone, device_name character varying, fracdim numeric, tags text, calculated_weight_kg real, cluster text, color text, clusterindex integer, hrzones integer[], powerzones integer[], cadencezones integer[])
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY 
    WITH target_ride AS (
        SELECT
            a.distance::DOUBLE PRECISION AS target_distance,
            b.centerlatitude AS target_lat,
            b.centerlongitude AS target_lon
        FROM rides a
        INNER JOIN rides_boundingbox b ON a.rideid = b.rideid
        WHERE a.rideid = p_rideid
    ),
    similar_rides AS (
        SELECT 
            a.rideid
        FROM rides a
        INNER JOIN rides_boundingbox b ON a.rideid = b.rideid
        CROSS JOIN target_ride t
        WHERE a.rideid <> p_rideid  -- Exclude the selected ride itself
        AND ABS(a.distance::DOUBLE PRECISION - t.target_distance) <= 5
        AND earth_distance(
            ll_to_earth(b.centerlatitude, b.centerlongitude),
            ll_to_earth(t.target_lat, t.target_lon)
        ) <= (1 * 1609.34)  -- Convert miles to meters
    ),
    ride_tags AS (
        SELECT 
            r.rideid,
            COALESCE(string_agg(t.name, ',' ORDER BY t.name), '') AS tags
        FROM rides r
        LEFT JOIN tagassignment ta
            ON ta.assignmentid = r.rideid 
            AND ta.locationid = 2 
            AND ta.riderid = p_riderid
        LEFT JOIN tags t ON t.tagid = ta.tagid
        WHERE r.riderid = p_riderid
            AND r.rideid IN (SELECT sr.rideid FROM similar_rides sr)
        GROUP BY r.rideid
    ),
    ride_with_weight AS (
        SELECT
            a.rideid,
            a.date,
            a.distance,
            a.speedavg,
            a.speedmax,
            a.cadence,
            a.hravg,
            a.hrmax,
            a.title,
            a.poweravg,
            a.powermax,
            a.bikeid,
            COALESCE(b.bikename, 'no bike')::TEXT AS bikename,
            COALESCE(b.stravaname, 'no bike')::TEXT AS stravaname,
            a.stravaid,
            a.comment,
            a.elevationgain,
            a.elapsedtime,
            a.powernormalized,
            a.intensityfactor,
            a.tss,
            a.matches,
            a.trainer,
            a.elevationloss,
            a.datenotime,
            a.device_name,
            a.fracdim,
            rt.tags,
            rw.weight::REAL AS weight_lbs,
            rc.tag::TEXT AS cluster,
            rc.color::TEXT AS color,
            rc.cluster AS clusterIndex,
            a.hrzones,
            a.powerzones,
            a.cadencezones,
            ROW_NUMBER() OVER (PARTITION BY a.rideid ORDER BY rw.date DESC) AS weight_rank
        FROM rides a
        LEFT JOIN bikes b ON a.bikeid = b.bikeid
        LEFT JOIN ride_tags rt ON a.rideid = rt.rideid
        LEFT JOIN ride_clusters rc ON a.rideid = rc.rideid
        LEFT JOIN riderweight rw ON rw.riderid = a.riderid 
            AND rw.date <= a.date  -- Match on the closest preceding date
        WHERE 
            a.riderid = p_riderid
            AND a.rideid IN (SELECT sr.rideid FROM similar_rides sr)
    )
    SELECT
        r.rideid,
        r.date,
        r.distance,
        r.speedavg,
        r.speedmax,
        r.cadence,
        r.hravg,
        r.hrmax,
        r.title,
        r.poweravg,
        r.powermax,
        r.bikeid,
        r.bikename,
        r.stravaname,
        r.stravaid,
        r.comment,
        r.elevationgain,
        r.elapsedtime,
        r.powernormalized,
        r.intensityfactor,
        r.tss,
        r.matches,
        r.trainer,
        r.elevationloss,
        r.datenotime,
        r.device_name,
        r.fracdim,
        r.tags,
        COALESCE(r.weight_lbs / 2.20462, 0.0)::REAL AS calculated_weight_kg,  -- Convert lbs to kg
        r.cluster,
        r.color,
        r.clusterIndex,
        r.hrzones,
        r.powerzones,
        r.cadencezones
    FROM ride_with_weight r
    WHERE r.weight_rank = 1  -- Get the most recent weight for each ride
    ORDER BY r.date DESC;
END;
$$;


ALTER FUNCTION public.get_similar_ride_routes(p_riderid integer, p_rideid integer, p_distance_threshold double precision, p_geo_threshold double precision) OWNER TO postgres;

--
-- Name: get_similar_rideid_efforts(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_similar_rideid_efforts(p_riderid integer, p_rideid integer) RETURNS TABLE(rideid integer, distance numeric, speedavg numeric, hravg numeric, powernormalized numeric, similarity_score numeric)
    LANGUAGE sql
    AS $$
WITH target_ride AS (
    SELECT (distance / NULLIF(speedavg, 0)) AS duration, hravg, powernormalized
    FROM rides
    WHERE riderid = p_riderid AND rideid = p_rideid
)
SELECT r.rideid, r.distance, r.speedavg, r.hravg, r.powernormalized,
       ROUND(
           CAST(
               SQRT(
                   POWER((r.distance / NULLIF(r.speedavg, 0)) - t.duration, 2) +
                   POWER(r.hravg - t.hravg, 2) +
                   POWER(r.powernormalized - t.powernormalized, 2)
               ) AS NUMERIC
           ), 4
       ) AS similarity_score
FROM rides r
JOIN target_ride t ON TRUE
WHERE r.riderid = p_riderid AND r.rideid <> p_rideid
ORDER BY similarity_score ASC
LIMIT 20;
$$;


ALTER FUNCTION public.get_similar_rideid_efforts(p_riderid integer, p_rideid integer) OWNER TO postgres;

--
-- Name: get_yearly_trainer_distance_summary(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_yearly_trainer_distance_summary(p_riderid integer) RETURNS TABLE(year integer, distance_outdoor numeric, distance_indoor numeric, total_distance numeric, pct_outdoor numeric, pct_indoor numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        CAST(EXTRACT(YEAR FROM date) AS INT) AS year,
        COALESCE(SUM(distance) FILTER (WHERE trainer = 0), 0) AS distance_outdoor,
        COALESCE(SUM(distance) FILTER (WHERE trainer = 1), 0) AS distance_indoor,
        COALESCE(SUM(distance), 0) AS total_distance,
        ROUND(
            100.0 * COALESCE(SUM(distance) FILTER (WHERE trainer = 0), 0) /
            NULLIF(COALESCE(SUM(distance), 0), 0), 1
        ) AS pct_outdoor,
        ROUND(
            100.0 * COALESCE(SUM(distance) FILTER (WHERE trainer = 1), 0) /
            NULLIF(COALESCE(SUM(distance), 0), 0), 1
        ) AS pct_indoor
    FROM
        rides
    WHERE
        rides.riderid = p_riderid
    GROUP BY
        CAST(EXTRACT(YEAR FROM date) AS INT)
    ORDER BY
        year;
END;
$$;


ALTER FUNCTION public.get_yearly_trainer_distance_summary(p_riderid integer) OWNER TO postgres;

--
-- Name: getriderproperty(integer, character varying, timestamp without time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.getriderproperty(p_riderid integer, p_property character varying, p_date timestamp without time zone DEFAULT CURRENT_TIMESTAMP) RETURNS TABLE(propertyid integer, riderid integer, property character varying, date timestamp without time zone, propertyvalue numeric, propertyvaluestring text)
    LANGUAGE plpgsql
    AS $$

BEGIN

    RETURN QUERY

    SELECT rpv.propertyid, rpv.riderid, rpv.property, rpv.date, rpv.propertyvalue, rpv.propertyvaluestring

    FROM riderpropertyvalues rpv

    WHERE rpv.riderid = p_riderid 

      AND rpv.property = p_property

      AND rpv.date <= p_date

    ORDER BY rpv.date DESC

    LIMIT 1;

END;

$$;


ALTER FUNCTION public.getriderproperty(p_riderid integer, p_property character varying, p_date timestamp without time zone) OWNER TO postgres;

--
-- Name: getriderweight(integer, timestamp without time zone, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.getriderweight(p_riderid integer, p_date timestamp without time zone DEFAULT now(), p_rideid integer DEFAULT NULL::integer) RETURNS real
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_weight7 REAL;
    v_ride_date TIMESTAMP WITHOUT TIME ZONE;
    effective_date TIMESTAMP WITHOUT TIME ZONE;
BEGIN
    -- If a rideid is provided, try to get its date
    IF p_rideid IS NOT NULL THEN
        SELECT date
        INTO v_ride_date
        FROM rides
        WHERE riderid = p_riderid
          AND rideid = p_rideid
        LIMIT 1;
    END IF;

    -- Use the ride's date if found; otherwise use the provided date (or current date)
    IF v_ride_date IS NOT NULL THEN
        effective_date := v_ride_date;
    ELSE
        effective_date := p_date;
    END IF;

    -- Retrieve the closest weight7 value on or before the effective date
    SELECT weight7
    INTO v_weight7
    FROM riderweight
    WHERE riderid = p_riderid
      AND date <= effective_date
    ORDER BY date DESC
    LIMIT 1;

    RETURN v_weight7;
END;
$$;


ALTER FUNCTION public.getriderweight(p_riderid integer, p_date timestamp without time zone, p_rideid integer) OWNER TO postgres;

--
-- Name: metrics_by_month_dom_calculate(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.metrics_by_month_dom_calculate(IN p_riderid integer)
    LANGUAGE plpgsql
    AS $$

BEGIN
    -- Delete any existing records for the riderid
    DELETE FROM public.metrics_by_month_dom
    WHERE riderid = p_riderid;

    -- Insert summarized metrics by month and day of month (dom)
    INSERT INTO public.metrics_by_month_dom (
        riderid,
		dom,
		distancejan,
		distancefeb,
		distancemar,
		distanceapr,
		distancemay,
		distancejun,
		distancejul,
		distanceaug,
		distancesep,
		distanceoct,
		distancenov,
		distancedec,
		distance,
		elevationgainjan,
		elevationgainfeb,
		elevationgainmar,
		elevationgainapr,
		elevationgainmay,
		elevationgainjun,
		elevationgainjul,
		elevationgainaug,
		elevationgainsep,
		elevationgainoct,
		elevationgainnov,
		elevationgaindec,
		elevationgain,
		elapsedtimejan,
		elapsedtimefeb,
		elapsedtimemar,
		elapsedtimeapr,
		elapsedtimemay,
		elapsedtimejun,
		elapsedtimejul,
		elapsedtimeaug,
		elapsedtimesep,
		elapsedtimeoct,
		elapsedtimenov,
		elapsedtimedec,
		elapsedtime,
		hraveragejan,
		hraveragefeb,
		hraveragemar,
		hraverageapr,
		hraveragemay,
		hraveragejun,
		hraveragejul,
		hraverageaug,
		hraveragesep,
		hraverageoct,
		hraveragenov,
		hraveragedec,
		hraverage,
		poweraveragejan,
		poweraveragefeb,
		poweraveragemar,
		poweraverageapr,
		poweraveragemay,
		poweraveragejun,
		poweraveragejul,
		poweraverageaug,
		poweraveragesep,
		poweraverageoct,
		poweraveragenov,
		poweraveragedec,
		poweraverage
    )
   WITH weekly_data AS (
    SELECT
        riderid,
        EXTRACT(DAY FROM ride_date) AS dom,
        EXTRACT(MONTH FROM ride_date) AS month,
        moving_total_distance1 AS distance,
        moving_total_elevationgain1 AS elevation_gain,
        moving_total_elapsedtime1 AS elapsed_time,
        moving_hr_average1 AS hr_average,
        moving_power_average1 AS power_average
    FROM
        public.cummulatives
	WHERE
		riderid = p_riderid
	)
	SELECT
		riderid,
        dom,
	    ROUND(SUM(distance) FILTER (WHERE month = 1),1) AS distancejan,
	    ROUND(SUM(distance) FILTER (WHERE month = 2),1) AS distancefeb,
	    ROUND(SUM(distance) FILTER (WHERE month = 3),1) AS distancemar,
	    ROUND(SUM(distance) FILTER (WHERE month = 4),1) AS distanceapr,
	    ROUND(SUM(distance) FILTER (WHERE month = 5),1) AS distancemay,
	    ROUND(SUM(distance) FILTER (WHERE month = 6),1) AS distancejun,
	    ROUND(SUM(distance) FILTER (WHERE month = 7),1) AS distancejul,
	    ROUND(SUM(distance) FILTER (WHERE month = 8),1) AS distanceaug,
	    ROUND(SUM(distance) FILTER (WHERE month = 9),1) AS distancesep,
	    ROUND(SUM(distance) FILTER (WHERE month = 10),1) AS distanceoct,
	    ROUND(SUM(distance) FILTER (WHERE month = 11),1) AS distancenov,
	    ROUND(SUM(distance) FILTER (WHERE month = 12),1) AS distancedec,
	    ROUND(SUM(distance),1) AS Distance,

	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 1),1) AS elevation_gainjan,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 2),1) AS elevation_gainfeb,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 3),1) AS elevation_gainmar,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 4),1) AS elevation_gainapr,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 5),1) AS elevation_gainmay,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 6),1) AS elevation_gainjun,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 7),1) AS elevation_gainjul,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 8),1) AS elevation_gainaug,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 9),1) AS elevation_gainsep,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 10),1) AS elevation_gainoct,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 11),1) AS elevation_gainnov,
	    ROUND(SUM(elevation_gain) FILTER (WHERE month = 12),1) AS elevation_gaindec,
	    ROUND(SUM(elevation_gain),0) AS ElevationGain,

	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 1),1) AS elapsed_timejan,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 2),1) AS elapsed_timefeb,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 3),1) AS elapsed_timemar,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 4),1) AS elapsed_timeapr,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 5),1) AS elapsed_timemay,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 6),1) AS elapsed_timejun,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 7),1) AS elapsed_timejul,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 8),1) AS elapsed_timeaug,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 9),1) AS elapsed_timesep,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 10),1) AS elapsed_timeoct,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 11),1) AS elapsed_timenov,
	    ROUND(SUM(elapsed_time) FILTER (WHERE month = 12),1) AS elapsed_timedec,
	    ROUND(SUM(elapsed_time),0) AS ElapsedTime,

		ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 1),1) AS hr_averagejan,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 2),1) AS hr_averagefeb,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 3),1) AS hr_averagemar,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 4),1) AS hr_averageapr,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 5),1) AS hr_averagemay,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 6),1) AS hr_averagejun,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 7),1) AS hr_averagejul,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 8),1) AS hr_averageaug,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 9),1) AS hr_averagesep,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 10),1) AS hr_averageoct,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 11),1) AS hr_averagenov,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE month = 12),1) AS hr_averagedec,
	    ROUND(AVG(NULLIF(hr_average,0)),0) AS HRAverage,

 	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 1),1) AS power_averagejan,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 2),1) AS power_averagefeb,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 3),1) AS power_averagemar,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 4),1) AS power_averageapr,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 5),1) AS power_averagemay,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 6),1) AS power_averagejun,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 7),1) AS power_averagejul,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 8),1) AS power_averageaug,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 9),1) AS power_averagesep,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 10),1) AS power_averageoct,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 11),1) AS power_averagenov,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE month = 12),1) AS power_averagedec,
	    ROUND(AVG(NULLIF(power_average,0)),0) AS PowerAverage
	FROM
	    weekly_data
	GROUP BY
	    riderid, dom
	ORDER BY
	    dom;
END;
$$;


ALTER PROCEDURE public.metrics_by_month_dom_calculate(IN p_riderid integer) OWNER TO postgres;

--
-- Name: metrics_by_year_dow_calculate(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.metrics_by_year_dow_calculate(IN p_riderid integer)
    LANGUAGE plpgsql
    AS $$

BEGIN
    -- Delete any existing records for the riderid
    DELETE FROM public.metrics_by_year_dow
    WHERE riderid = p_riderid;

    -- Insert summarized metrics by year and dow
    INSERT INTO public.metrics_by_year_dow (
        riderid,
		year, 
		distancemonday,
		distancetuesday,
		distancewednesday,
		distancethursday,
		distancefriday,
		distancesaturday,
		distancesunday,
		distance,
		elevationgainmonday,
		elevationgaintuesday,
		elevationgainwednesday,
		elevationgainthursday,
		elevationgainfriday,
		elevationgainsaturday,
		elevationgainsunday,
		elevationgain,
		elapsedtimemonday,
		elapsedtimetuesday,
		elapsedtimewednesday,
		elapsedtimethursday,
		elapsedtimefriday,
		elapsedtimesaturday,
		elapsedtimesunday,
		elapsedtime,
		hraveragemonday,
		hraveragetuesday,
		hraveragewednesday,
		hraveragethursday,
		hraveragefriday,
		hraveragesaturday,
		hraveragesunday,
		hraverage,
		poweraveragemonday,
		poweraveragetuesday,
		poweraveragewednesday,
		poweraveragethursday,
		poweraveragefriday,
		poweraveragesaturday,
		poweraveragesunday,
		poweraverage
    )
   WITH weekly_data AS (
    SELECT
        riderid,
        EXTRACT(YEAR FROM ride_date) AS ride_year,
        TRIM(TO_CHAR(ride_date, 'Day')) AS day_of_week,
        moving_total_distance1 AS distance,
        moving_total_elevationgain1 AS elevation_gain,
        moving_total_elapsedtime1 AS elapsed_time,
        moving_hr_average1 AS hr_average,
        moving_power_average1 AS power_average
    FROM
        public.cummulatives
	WHERE
		riderid = p_riderid
	)
	SELECT
		riderid,
	    ride_year,
	    ROUND(SUM(distance) FILTER (WHERE day_of_week = 'Monday'),1) AS DistanceMonday,
	    ROUND(SUM(distance) FILTER (WHERE day_of_week = 'Tuesday'),1) AS DistanceTuesday,
	    ROUND(SUM(distance) FILTER (WHERE day_of_week = 'Wednesday'),1) AS DistanceWednesday,
	    ROUND(SUM(distance) FILTER (WHERE day_of_week = 'Thursday'),1) AS DistanceThursday,
	    ROUND(SUM(distance) FILTER (WHERE day_of_week = 'Friday'),1) AS DistanceFriday,
	    ROUND(SUM(distance) FILTER (WHERE day_of_week = 'Saturday'),1) AS DistanceSaturday,
	    ROUND(SUM(distance) FILTER (WHERE day_of_week = 'Sunday'),1) AS DistanceSunday,
	    ROUND(SUM(distance),1) AS Distance,
	    ROUND(SUM(elevation_gain) FILTER (WHERE day_of_week = 'Monday'),0) AS ElevationGainMonday,
	    ROUND(SUM(elevation_gain) FILTER (WHERE day_of_week = 'Tuesday'),0) AS ElevationGainTuesday,
	    ROUND(SUM(elevation_gain) FILTER (WHERE day_of_week = 'Wednesday'),0) AS ElevationGainWednesday,
	    ROUND(SUM(elevation_gain) FILTER (WHERE day_of_week = 'Thursday'),0) AS ElevationGainThursday,
	    ROUND(SUM(elevation_gain) FILTER (WHERE day_of_week = 'Friday'),0) AS ElevationGainFriday,
	    ROUND(SUM(elevation_gain) FILTER (WHERE day_of_week = 'Saturday'),0) AS ElevationGainSaturday,
	    ROUND(SUM(elevation_gain) FILTER (WHERE day_of_week = 'Sunday'),0) AS ElevationGainSunday,
	    ROUND(SUM(elevation_gain),0) AS ElevationGain,
	    ROUND(SUM(elapsed_time) FILTER (WHERE day_of_week = 'Monday'),0) AS ElapsedTimeMonday,
	    ROUND(SUM(elapsed_time) FILTER (WHERE day_of_week = 'Tuesday'),0) AS ElapsedTimeTuesday,
	    ROUND(SUM(elapsed_time) FILTER (WHERE day_of_week = 'Wednesday'),0) AS ElapsedTimeWednesday,
	    ROUND(SUM(elapsed_time) FILTER (WHERE day_of_week = 'Thursday'),0) AS ElapsedTimeThursday,
	    ROUND(SUM(elapsed_time) FILTER (WHERE day_of_week = 'Friday'),0) AS ElapsedTimeFriday,
	    ROUND(SUM(elapsed_time) FILTER (WHERE day_of_week = 'Saturday'),0) AS ElapsedTimeSaturday,
	    ROUND(SUM(elapsed_time) FILTER (WHERE day_of_week = 'Sunday'),0) AS ElapsedTimeSunday,
	    ROUND(SUM(elapsed_time),0) AS ElapsedTime,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE day_of_week = 'Monday'),0) AS HRAverageMonday,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE day_of_week = 'Tuesday'),0) AS HRAverageTuesday,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE day_of_week = 'Wednesday'),0) AS HRAverageWednesday,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE day_of_week = 'Thursday'),0) AS HRAverageThursday,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE day_of_week = 'Friday'),0) AS HRAverageFriday,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE day_of_week = 'Saturday'),0) AS HRAverageSaturday,
	    ROUND(AVG(NULLIF(hr_average,0)) FILTER (WHERE day_of_week = 'Sunday'),0) AS HRAverageSunday,
	    ROUND(AVG(NULLIF(hr_average,0)),0) AS HRAverage,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE day_of_week = 'Monday'),0) AS PowerAverageMonday,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE day_of_week = 'Tuesday'),0) AS PowerAverageTuesday,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE day_of_week = 'Wednesday'),0) AS PowerAverageWednesday,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE day_of_week = 'Thursday'),0) AS PowerAverageThursday,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE day_of_week = 'Friday'),0) AS PowerAverageFriday,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE day_of_week = 'Saturday'),0) AS PowerAverageSaturday,
	    ROUND(AVG(NULLIF(power_average,0)) FILTER (WHERE day_of_week = 'Sunday'),0) AS PowerAverageSunday,
	    ROUND(AVG(NULLIF(power_average,0)),0) AS PowerAverage
	FROM
	    weekly_data
	GROUP BY
	    riderid, ride_year
	ORDER BY
	    ride_year;
END;
$$;


ALTER PROCEDURE public.metrics_by_year_dow_calculate(IN p_riderid integer) OWNER TO postgres;

--
-- Name: metrics_by_year_month_calculate(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.metrics_by_year_month_calculate(IN p_riderid integer)
    LANGUAGE plpgsql
    AS $$

BEGIN

    -- Delete any existing records for the riderid

    DELETE FROM public.metrics_by_year_month

    WHERE riderid = p_riderid;



    -- Insert summarized metrics by year and month

    INSERT INTO public.metrics_by_year_month (

        riderid, year, month, month_name, total_distance, avg_speedavg, max_speedmax, avg_cadence, avg_hravg,

        max_hrmax, avg_poweravg, max_powermax, total_elevationgain, total_elapsedtime_hours, avg_powernormalized, insertdttm

    )

    SELECT

        riderid,

        EXTRACT(YEAR FROM date) AS year,

        EXTRACT(MONTH FROM date) AS month,

        TO_CHAR(date, 'Month') AS month_name,

        ROUND(SUM(distance), 1) AS total_distance,

        ROUND(AVG(speedavg), 1) AS avg_speedavg,

        ROUND(MAX(speedmax), 1) AS max_speedmax,

        COALESCE(ROUND(AVG(cadence), 0), 0) AS avg_cadence,

        COALESCE(ROUND(AVG(NULLIF(hravg, 0)), 0), 0) AS avg_hravg,

        COALESCE(ROUND(MAX(NULLIF(hrmax, 0)), 0), 0) AS max_hrmax,

        COALESCE(ROUND(AVG(NULLIF(poweravg, 0)), 0), 0) AS avg_poweravg,

        COALESCE(ROUND(MAX(NULLIF(powermax, 0)), 0), 0) AS max_powermax,

        COALESCE(ROUND(SUM(NULLIF(elevationgain, 0)), 0), 0) AS total_elevationgain,

        ROUND(SUM(elapsedtime) / 3600.0, 1) AS total_elapsedtime_hours,

        COALESCE(ROUND(AVG(NULLIF(powernormalized, 0)), 0), 0) AS avg_powernormalized,

        CURRENT_TIMESTAMP AS insertdttm

    FROM public.rides

    WHERE riderid = p_riderid

    GROUP BY riderid, EXTRACT(YEAR FROM date), EXTRACT(MONTH FROM date), TO_CHAR(date, 'Month');



END;

$$;


ALTER PROCEDURE public.metrics_by_year_month_calculate(IN p_riderid integer) OWNER TO postgres;

--
-- Name: summarize_rides_and_goals(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.summarize_rides_and_goals(p_riderid integer) RETURNS TABLE(date text, miles_today_actual numeric, elevation_today_actual numeric, time_today_actual numeric, miles_week_actual numeric, miles_week_target numeric, miles_week_delta numeric, miles_week_perday numeric, elevation_week_actual numeric, time_week_actual numeric, time_week_target numeric, time_week_delta numeric, time_week_perday numeric, miles_month_actual numeric, miles_month_target numeric, miles_month_delta numeric, miles_month_perday numeric, elevation_month_actual numeric, time_month_actual numeric, time_month_target numeric, time_month_delta numeric, time_month_perday numeric, miles_year_actual numeric, miles_year_target numeric, miles_year_delta numeric, miles_year_perday numeric, elevation_year_actual numeric, time_year_actual numeric, time_year_target numeric, time_year_delta numeric, time_year_perday numeric, miles_alltime_actual numeric, elevation_alltime_actual numeric, time_alltime_actual numeric, miles_alltime_perday numeric, elevation_alltime_perday numeric, time_alltime_perday numeric, total_days_alltime integer)
    LANGUAGE plpgsql
    AS $$







DECLARE

    -- Variables to store the target values from ridergoals

    week_target_distance NUMERIC;

    month_target_distance NUMERIC;

    year_target_distance NUMERIC;

    week_target_time NUMERIC;

    month_target_time NUMERIC;

    year_target_time NUMERIC;



    -- Variables for dates and fractions

    current_date DATE := CURRENT_DATE;

    week_start DATE;

    week_end DATE;

    days_in_week NUMERIC := 7;

    days_in_month NUMERIC;

    day_of_week NUMERIC;

    day_of_month NUMERIC;

    days_in_year NUMERIC;

    day_of_year NUMERIC;



 -- Variables for the earliest and latest ride dates

    first_ride DATE;

    last_ride DATE;

BEGIN

    -- Get the rider's goals

    SELECT week, month, year INTO week_target_distance, month_target_distance, year_target_distance

    FROM ridergoals WHERE riderid = p_riderid AND goalid = 0;



    SELECT week, month, year INTO week_target_time, month_target_time, year_target_time

    FROM ridergoals WHERE riderid = p_riderid AND goalid = 1;



    -- Get the week start (Monday) and end (Sunday)

    week_start := current_date - INTERVAL '1 day' * ((EXTRACT(DOW FROM current_date)::integer + 6) % 7);

    

    -- Calculate week_end as 6 days after the week_start

    week_end := week_start + INTERVAL '6 days';



    -- Get date information

    day_of_week := CASE WHEN EXTRACT(DOW FROM current_date) = 0 THEN 7 ELSE EXTRACT(DOW FROM current_date) END;

    day_of_month := EXTRACT(DAY FROM current_date);

    day_of_year := EXTRACT(DOY FROM current_date);

    days_in_year := EXTRACT(DOY FROM make_date(EXTRACT(YEAR FROM current_date)::INTEGER + 1, 1, 1) - INTERVAL '1 day');

    days_in_month := EXTRACT(DAY FROM (DATE_TRUNC('month', current_date) + INTERVAL '1 month - 1 day'));



    -- Today's summary

    SELECT COALESCE(SUM(distance), 0), COALESCE(SUM(elevationgain), 0), COALESCE(SUM(elapsedtime) / 3600, 0)

    INTO miles_today_actual, elevation_today_actual, time_today_actual

    FROM rides WHERE riderid = p_riderid AND date_trunc('day', rides.date) = current_date;



    -- This week's summary

    SELECT COALESCE(SUM(distance), 0), COALESCE(SUM(elevationgain), 0), COALESCE(SUM(elapsedtime) / 3600, 0)

    INTO miles_week_actual, elevation_week_actual, time_week_actual

    FROM rides WHERE riderid = p_riderid AND date_trunc('day', rides.date) BETWEEN week_start AND week_end;



    miles_week_target := week_target_distance * (day_of_week / days_in_week);

    miles_week_delta := miles_week_actual - miles_week_target;

    miles_week_perday := miles_week_actual / day_of_week;



    time_week_target := week_target_time * (day_of_week / days_in_week);

    time_week_delta := time_week_actual - time_week_target;

    time_week_perday := time_week_actual / day_of_week;



    -- This month's summary

    SELECT COALESCE(SUM(distance), 0), COALESCE(SUM(elevationgain), 0), COALESCE(SUM(elapsedtime) / 3600, 0)

    INTO miles_month_actual, elevation_month_actual, time_month_actual

    FROM rides WHERE riderid = p_riderid AND extract(year FROM rides.date) = extract(year FROM current_date)

    AND extract(month FROM rides.date) = extract(month FROM current_date);



    miles_month_target := month_target_distance * (day_of_month / days_in_month);

    miles_month_delta := miles_month_actual - miles_month_target;

    miles_month_perday := miles_month_actual / day_of_month;



    time_month_target := month_target_time * (day_of_month / days_in_month);

    time_month_delta := time_month_actual - time_month_target;

    time_month_perday := time_month_actual / day_of_month;



    -- This year's summary

    SELECT COALESCE(SUM(distance), 0), COALESCE(SUM(elevationgain), 0), COALESCE(SUM(elapsedtime) / 3600, 0)

    INTO miles_year_actual, elevation_year_actual, time_year_actual

    FROM rides WHERE riderid = p_riderid AND extract(year FROM rides.date) = extract(year FROM current_date);



    miles_year_target := year_target_distance * (day_of_year / days_in_year);

    miles_year_delta := miles_year_actual - miles_year_target;

    miles_year_perday := miles_year_actual / day_of_year;



    time_year_target := year_target_time * (day_of_year / days_in_year);

    time_year_delta := time_year_actual - time_year_target;

    time_year_perday := time_year_actual / day_of_year;



    -- All-time summary

    SELECT COALESCE(SUM(distance), 0), COALESCE(SUM(elevationgain), 0), COALESCE(SUM(elapsedtime) / 3600, 0)

    INTO miles_alltime_actual, elevation_alltime_actual, time_alltime_actual

    FROM rides WHERE riderid = p_riderid;



     -- Calculate the total number of days from the first to the last ride (inclusive)

    SELECT MIN(rides.date), MAX(rides.date)

    INTO first_ride, last_ride

    FROM rides WHERE riderid = p_riderid;



    total_days_alltime := last_ride - first_ride + 1;



    miles_alltime_perday := miles_alltime_actual / total_days_alltime;

	elevation_alltime_perday := elevation_alltime_actual / total_days_alltime;

    time_alltime_perday := time_alltime_actual / total_days_alltime;



    -- Return final result

    RETURN QUERY

    SELECT to_char(current_date, 'YYYY-MM-DD'),

           ROUND(miles_today_actual,1) as miles_today_actual,

		   ROUND(elevation_today_actual,0) as elevation_today_actual,

   	       ROUND(time_today_actual,1) as time_today_actual,

           ROUND(miles_week_actual,1) as miles_week_actual,

		   ROUND(miles_week_target,1) as miles_week_target,

		   ROUND(miles_week_delta,1) as miles_week_delta,

		   ROUND(miles_week_perday,1) as miles_week_perday,

           ROUND(elevation_week_actual,0) as elevation_week_actual,

           ROUND(time_week_actual,1) as time_week_actual,

		   ROUND(time_week_target,1) as time_week_target,

		   ROUND(time_week_delta,1) as time_week_delta,

		   ROUND(time_week_perday,1) as time_week_perday,

           ROUND(miles_month_actual,1) as miles_month_actual,

		   ROUND(miles_month_target,1) as miles_month_target,

		   ROUND(miles_month_delta,1) as miles_month_delta,

		   ROUND(miles_month_perday,1) as miles_month_perday,

           ROUND(elevation_month_actual,0) as elevation_month_actual,

           ROUND(time_month_actual,1) as time_month_actual,

		   ROUND(time_month_target,1) as time_month_target,

		   ROUND(time_month_delta,1) as time_month_delta,

		   ROUND(time_month_perday,1) as time_month_perday,

           ROUND(miles_year_actual,1) as miles_year_actual,

		   ROUND(miles_year_target,1) as miles_year_target,

		   ROUND(miles_year_delta,1) as miles_year_delta,

		   ROUND(miles_year_perday,1) as miles_year_perday,

           ROUND(elevation_year_actual,0) as elevation_year_actual,

           ROUND(time_year_actual,1) as time_year_actual,

		   ROUND(time_year_target,1) as time_year_target,

		   ROUND(time_year_delta,1) as time_year_delta,

		   ROUND(time_year_perday,1) as time_year_perday,

           ROUND(miles_alltime_actual,1) as miles_alltime_actual,

		   ROUND(elevation_alltime_actual,0) as elevation_alltime_actual,

		   ROUND(time_alltime_actual,1) as time_alltime_actual,

		   ROUND(miles_alltime_perday,2) as miles_alltime_perday,

		   ROUND(elevation_alltime_perday,0) as elevation_alltime_perday,

		   ROUND(time_alltime_perday,1) as time_alltime_perday,

           total_days_alltime;

END;

$$;


ALTER FUNCTION public.summarize_rides_and_goals(p_riderid integer) OWNER TO postgres;

--
-- Name: summarize_rides_by_year_and_month(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.summarize_rides_by_year_and_month(p_riderid integer) RETURNS TABLE(rideyear integer, total_distance_miles numeric, jan_distance numeric, feb_distance numeric, mar_distance numeric, apr_distance numeric, may_distance numeric, jun_distance numeric, jul_distance numeric, aug_distance numeric, sep_distance numeric, oct_distance numeric, nov_distance numeric, dec_distance numeric, total_elevationgain numeric, jan_elevationgain numeric, feb_elevationgain numeric, mar_elevationgain numeric, apr_elevationgain numeric, may_elevationgain numeric, jun_elevationgain numeric, jul_elevationgain numeric, aug_elevationgain numeric, sep_elevationgain numeric, oct_elevationgain numeric, nov_elevationgain numeric, dec_elevationgain numeric, total_elapsedtime_hours numeric, jan_elapsedtime_hours numeric, feb_elapsedtime_hours numeric, mar_elapsedtime_hours numeric, apr_elapsedtime_hours numeric, may_elapsedtime_hours numeric, jun_elapsedtime_hours numeric, jul_elapsedtime_hours numeric, aug_elapsedtime_hours numeric, sep_elapsedtime_hours numeric, oct_elapsedtime_hours numeric, nov_elapsedtime_hours numeric, dec_elapsedtime_hours numeric)
    LANGUAGE plpgsql
    AS $$



BEGIN

    RETURN QUERY

    SELECT

        EXTRACT(YEAR FROM date)::integer AS rideyear,

        ROUND(SUM(distance), 1) AS total_distance_miles,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 1 THEN distance ELSE 0 END), 1) AS jan_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 2 THEN distance ELSE 0 END), 1) AS feb_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 3 THEN distance ELSE 0 END), 1) AS mar_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 4 THEN distance ELSE 0 END), 1) AS apr_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 5 THEN distance ELSE 0 END), 1) AS may_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 6 THEN distance ELSE 0 END), 1) AS jun_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 7 THEN distance ELSE 0 END), 1) AS jul_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 8 THEN distance ELSE 0 END), 1) AS aug_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 9 THEN distance ELSE 0 END), 1) AS sep_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 10 THEN distance ELSE 0 END), 1) AS oct_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 11 THEN distance ELSE 0 END), 1) AS nov_distance,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 12 THEN distance ELSE 0 END), 1) AS dec_distance,



        -- Rounded elevation gain (0 decimal places)

        ROUND(SUM(elevationgain), 0) AS total_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 1 THEN elevationgain ELSE 0 END), 0) AS jan_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 2 THEN elevationgain ELSE 0 END), 0) AS feb_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 3 THEN elevationgain ELSE 0 END), 0) AS mar_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 4 THEN elevationgain ELSE 0 END), 0) AS apr_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 5 THEN elevationgain ELSE 0 END), 0) AS may_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 6 THEN elevationgain ELSE 0 END), 0) AS jun_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 7 THEN elevationgain ELSE 0 END), 0) AS jul_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 8 THEN elevationgain ELSE 0 END), 0) AS aug_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 9 THEN elevationgain ELSE 0 END), 0) AS sep_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 10 THEN elevationgain ELSE 0 END), 0) AS oct_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 11 THEN elevationgain ELSE 0 END), 0) AS nov_elevationgain,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 12 THEN elevationgain ELSE 0 END), 0) AS dec_elevationgain,



        -- Rounded elapsed time in hours (1 decimal place)

        ROUND(SUM(elapsedtime / 3600.0), 1) AS total_elapsedtime_hours,  

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 1 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS jan_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 2 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS feb_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 3 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS mar_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 4 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS apr_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 5 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS may_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 6 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS jun_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 7 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS jul_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 8 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS aug_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 9 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS sep_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 10 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS oct_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 11 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS nov_elapsedtime_hours,

        ROUND(SUM(CASE WHEN EXTRACT(MONTH FROM date) = 12 THEN elapsedtime / 3600.0 ELSE 0 END), 1) AS dec_elapsedtime_hours

    FROM rides

    WHERE riderid = 1

    GROUP BY EXTRACT(YEAR FROM date)

    ORDER BY rideyear desc;

END;

$$;


ALTER FUNCTION public.summarize_rides_by_year_and_month(p_riderid integer) OWNER TO postgres;

--
-- Name: update_accesstokenexpiresutc(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_accesstokenexpiresutc() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

BEGIN

    -- Convert UNIX timestamp to UTC timestamp

    NEW.accesstokenexpiresutc := to_timestamp(NEW.accesstokenexpires);

    RETURN NEW;

END;

$$;


ALTER FUNCTION public.update_accesstokenexpiresutc() OWNER TO postgres;

--
-- Name: update_cluster_names(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.update_cluster_names(IN riderid_input integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    active_clusterid INT;
    max_elevationgain_record INT;
    max_powernormalized_record INT;
    min_hravg_record INT;
    remaining_record INT;
BEGIN
    -- Find the active clusterid for the given riderid
    SELECT clusterid
    INTO active_clusterid
    FROM Clusters
    WHERE riderid = riderid_input AND active = TRUE;

    -- Assign 'Hilly' to the record with the highest elevationgain
    SELECT cluster
    INTO max_elevationgain_record
    FROM cluster_centroids
    WHERE clusterid = active_clusterid
    ORDER BY elevationgain DESC
    LIMIT 1;

    UPDATE cluster_centroids
    SET name = 'Hilly', color = '#7ed321'
    WHERE clusterid = active_clusterid AND cluster = max_elevationgain_record;

    -- Assign 'Race' to the record with the highest powernormalized
    SELECT cluster
    INTO max_powernormalized_record
    FROM cluster_centroids
    WHERE clusterid = active_clusterid
    ORDER BY powernormalized DESC
    LIMIT 1;

    UPDATE cluster_centroids
    SET name = 'Race', color = '#d0021b'
    WHERE clusterid = active_clusterid AND cluster = max_powernormalized_record;

    -- Assign 'Easy' to the record with the lowest hravg
    SELECT cluster
    INTO min_hravg_record
    FROM cluster_centroids
    WHERE clusterid = active_clusterid
    ORDER BY hravg ASC
    LIMIT 1;

    UPDATE cluster_centroids
    SET name = 'Easy', color = '#4a90e2'
    WHERE clusterid = active_clusterid AND cluster = min_hravg_record;

    -- Assign 'Tempo' to the remaining record
    SELECT cluster
    INTO remaining_record
    FROM cluster_centroids
    WHERE clusterid = active_clusterid
      AND cluster NOT IN (max_elevationgain_record, max_powernormalized_record, min_hravg_record)
    LIMIT 1;

    IF remaining_record IS NOT NULL THEN
        UPDATE cluster_centroids
        SET name = 'Tempo', color = '#bd10e0'
        WHERE clusterid = active_clusterid AND cluster = remaining_record;
    END IF;

END;
$$;


ALTER PROCEDURE public.update_cluster_names(IN riderid_input integer) OWNER TO postgres;

--
-- Name: update_cummulatives(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.update_cummulatives(IN p_riderid integer)
    LANGUAGE plpgsql
    AS $$

BEGIN
	-- Step 1: Delete all records for riderid
	DELETE FROM public.cummulatives
	WHERE riderid = p_riderid;

	-- Step 2: Insert blank records for each day between earliest ride date and 3 days after the latest ride date
	INSERT INTO public.cummulatives(
	    riderid,
	    ride_date,
	    moving_total_distance1,
	    moving_total_elevationgain1,
	    moving_total_elapsedtime1,
	    moving_hr_average1,
	    moving_power_average1,
	    moving_total_distance7,
	    moving_total_elevationgain7,
	    moving_total_elapsedtime7,
	    moving_hr_average7,
	    moving_power_average7,
	    moving_total_distance30,
	    moving_total_elevationgain30,
	    moving_total_elapsedtime30,
	    moving_hr_average30,
	    moving_power_average30,
	    moving_total_distance365,
	    moving_total_elevationgain365,
	    moving_total_elapsedtime365,
	    moving_hr_average365,
	    moving_power_average365,
	    moving_total_distancealltime,
	    moving_total_elevationgainalltime,
	    moving_total_elapsedtimealltime,
	    moving_hr_averagealltime,
	    moving_power_averagealltime,
	    total_tss,
	    fatigue,
	    fitness,
	    form,
	    tss30
	)
	SELECT
		DISTINCT
	    p_riderid AS riderid,
	    generate_series(
	        (SELECT MIN(DATE("date")) FROM rides WHERE riderid = p_riderid),
	        (SELECT (MAX(DATE("date")) + INTERVAL '3 days')::date FROM rides WHERE riderid = p_riderid),
	        INTERVAL '1 day'
	    )::date AS ride_date,
	    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0;

	-- Step 3: Calculate daily totals for the rider
	WITH daily_totals AS (
	    SELECT
	        riderid,
	        DATE("date") AS ride_date,
	        ROUND(SUM(distance), 1) AS moving_total_distance1,
	        ROUND(SUM(elevationgain), 0) AS moving_total_elevationgain1,
	        SUM(elapsedtime) AS moving_total_elapsedtime1,
	        ROUND(AVG(hravg), 0) AS moving_hr_average1,
	        ROUND(AVG(poweravg), 0) AS moving_power_average1,
	        SUM(tss) AS total_tss
	    FROM rides
	    WHERE riderid = p_riderid
	    GROUP BY riderid, DATE("date")
	)

	-- Step 4: Update the cummulatives table with daily totals
	UPDATE cummulatives A
	SET
	    moving_total_distance1 = COALESCE(B.moving_total_distance1, 0.0),
	    moving_total_elevationgain1 = COALESCE(B.moving_total_elevationgain1, 0.0),
	    moving_total_elapsedtime1 = ROUND(COALESCE(B.moving_total_elapsedtime1, 0)/ (60.0 * 60),2),
	    moving_hr_average1 = COALESCE(B.moving_hr_average1, 0),
	    moving_power_average1 = COALESCE(B.moving_power_average1, 0),
	    total_tss = COALESCE(B.total_tss, 0.0)
	FROM daily_totals B
	WHERE A.riderid = B.riderid
	  AND A.ride_date = B.ride_date;

	-- Step 5: Update 7 day totals
	UPDATE cummulatives A
	SET
	    moving_total_distance7 = COALESCE(B.moving_total_distance7, 0.0),
	    moving_total_elevationgain7 = COALESCE(B.moving_total_elevationgain7, 0.0),
	    moving_total_elapsedtime7 = COALESCE(B.moving_total_elapsedtime7, 0),
	    moving_hr_average7 = COALESCE(B.moving_hr_average7, 0),
	    moving_power_average7 = COALESCE(B.moving_power_average7, 0)
	FROM (
	    SELECT
	        riderid,
	        ride_date,

	        -- 7-day moving totals
	        ROUND(CAST(SUM(moving_total_distance1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
	        ) AS numeric), 1) AS moving_total_distance7,
	        SUM(moving_total_elevationgain1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
	        ) AS moving_total_elevationgain7,
	        ROUND(CAST(SUM(moving_total_elapsedtime1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_total_elapsedtime7,
	        ROUND(CAST(AVG(moving_hr_average1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_hr_average7,
	        ROUND(CAST(AVG(moving_power_average1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_power_average7
	    FROM
	        cummulatives
	) B
	WHERE A.riderid = B.riderid
	  AND A.ride_date = B.ride_date;

	-- Step 6: Update 30 day totals
	UPDATE cummulatives A
	SET
	    moving_total_distance30 = COALESCE(B.moving_total_distance30, 0.0),
	    moving_total_elevationgain30 = COALESCE(B.moving_total_elevationgain30, 0.0),
	    moving_total_elapsedtime30 = COALESCE(B.moving_total_elapsedtime30, 0),
	    moving_hr_average30 = COALESCE(B.moving_hr_average30, 0),
	    moving_power_average30 = COALESCE(B.moving_power_average30, 0)
	FROM (
	    SELECT
	        riderid,
	        ride_date,

	        -- 30-day moving totals
	        ROUND(CAST(SUM(moving_total_distance1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
	        ) AS numeric), 1) AS moving_total_distance30,
	        SUM(moving_total_elevationgain1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
	        ) AS moving_total_elevationgain30,
	        ROUND(CAST(SUM(moving_total_elapsedtime1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_total_elapsedtime30,
	        ROUND(CAST(AVG(moving_hr_average1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_hr_average30,
	        ROUND(CAST(AVG(moving_power_average1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_power_average30
	    FROM
	        cummulatives
	) B
	WHERE A.riderid = B.riderid
	  AND A.ride_date = B.ride_date;

	-- Step 7: Update 365 day totals
	UPDATE cummulatives A
	SET
	    moving_total_distance365 = COALESCE(B.moving_total_distance365, 0.0),
	    moving_total_elevationgain365 = COALESCE(B.moving_total_elevationgain365, 0.0),
	    moving_total_elapsedtime365 = COALESCE(B.moving_total_elapsedtime365, 0),
	    moving_hr_average365 = COALESCE(B.moving_hr_average365, 0),
	    moving_power_average365 = COALESCE(B.moving_power_average365, 0)
	FROM (
	    SELECT
	        riderid,
	        ride_date,

	        -- 365-day moving totals
	        ROUND(CAST(SUM(moving_total_distance1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 364 PRECEDING AND CURRENT ROW
	        ) AS numeric), 1) AS moving_total_distance365,
	        SUM(moving_total_elevationgain1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 364 PRECEDING AND CURRENT ROW
	        ) AS moving_total_elevationgain365,
	        ROUND(CAST(SUM(moving_total_elapsedtime1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 364 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_total_elapsedtime365,
	        ROUND(CAST(AVG(moving_hr_average1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 364 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_hr_average365,
	        ROUND(CAST(AVG(moving_power_average1) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 364 PRECEDING AND CURRENT ROW
	        ) AS numeric), 0) AS moving_power_average365
	    FROM
	        cummulatives
	) B
	WHERE A.riderid = B.riderid
	  AND A.ride_date = B.ride_date;

	-- Step 8: Update all time totals
	UPDATE cummulatives A
	SET
	    moving_total_distancealltime = COALESCE(B.moving_total_distancealltime, 0.0),
	    moving_total_elevationgainalltime = COALESCE(B.moving_total_elevationgainalltime, 0.0),
	    moving_total_elapsedtimealltime = COALESCE(B.moving_total_elapsedtimealltime, 0),
	    moving_hr_averagealltime = COALESCE(B.moving_hr_averagealltime, 0),
	    moving_power_averagealltime = COALESCE(B.moving_power_averagealltime, 0)
	FROM (
		SELECT
		    riderid,
		    ride_date,
		
		    -- Moving totals (cumulative up to the current row, ordered by ride_date)
		    ROUND(CAST(SUM(moving_total_distance1) OVER (ORDER BY ride_date) AS numeric), 1) AS moving_total_distanceAlltime,
		    SUM(moving_total_elevationgain1) OVER (ORDER BY ride_date) AS moving_total_elevationgainalltime,
		    ROUND(CAST(SUM(moving_total_elapsedtime1) OVER (ORDER BY ride_date) AS numeric) / (60.0 * 60), 0) AS moving_total_elapsedtimealltime,
		    ROUND(CAST(AVG(NULLIF(moving_hr_average1, 0)) OVER (ORDER BY ride_date) AS numeric), 0) AS moving_hr_averagealltime,
		    ROUND(CAST(AVG(NULLIF(moving_power_average1, 0)) OVER (ORDER BY ride_date) AS numeric), 0) AS moving_power_averagealltime
		FROM
		    cummulatives
		ORDER BY
		    ride_date
	) B
	WHERE A.riderid = B.riderid
	AND A.ride_date = B.ride_date;

	-- Step 9: Update FFF values
	UPDATE cummulatives A
	SET
	    fatigue = COALESCE(B.fatigue, 0.0),
	    fitness = COALESCE(B.fitness, 0.0),
	    form = COALESCE(B.form, 0),
	    tss30 = COALESCE(B.tss30, 0)
	FROM (
	    SELECT
	        riderid,
	        ride_date,

	        -- Fatigue
	        ROUND(CAST(SUM(total_tss) OVER (
	           ORDER BY ride_date
	           ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
	        ) AS numeric) / 7.0, 0) AS fatigue,
	        ROUND(CAST(SUM(total_tss) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 41 PRECEDING AND CURRENT ROW
	        ) AS numeric) / 42.0, 0) AS fitness,
	        (
	            ROUND(CAST(SUM(total_tss) OVER (
	                ORDER BY ride_date
	                ROWS BETWEEN 41 PRECEDING AND CURRENT ROW
	            ) AS numeric) / 42.0, 0)
	            -
	            ROUND(CAST(SUM(total_tss) OVER (
	                ORDER BY ride_date
	                ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
	            ) AS numeric) / 7.0, 0)
	        ) AS form,
	        ROUND(CAST(SUM(total_tss) OVER (
	            ORDER BY ride_date
	            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
	        ) AS numeric) / 30.0, 0) AS tss30
	    FROM
	        cummulatives
	) B
	WHERE A.riderid = B.riderid
	AND A.ride_date = B.ride_date;

	-- Step 10: Update rider runs
	Call find_rider_runs(p_riderid);

	-- Step 11: Update run data in cummulatives
	Call update_run_data(p_riderid);

END;
$$;


ALTER PROCEDURE public.update_cummulatives(IN p_riderid integer) OWNER TO postgres;

--
-- Name: update_ride_clusters_with_tags(integer, integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.update_ride_clusters_with_tags(IN riderid_param integer, IN clusterid_param integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    ride_date DATE;
    rideid_var INTEGER; -- Rename variable to avoid ambiguity
    cluster_record RECORD;
BEGIN
    -- Iterate over each ride in the ride_clusters table for the given riderid
    FOR ride_date, rideid_var IN
        SELECT r.date, rc.rideid
        FROM rides r
        JOIN ride_clusters rc ON r.riderid = rc.riderid AND r.rideid = rc.rideid
        WHERE r.riderid = riderid_param
    LOOP
        -- Find the first matching cluster_centroids record for the ride's date
        SELECT INTO cluster_record *
        FROM cluster_centroids c
        WHERE c.riderid = riderid_param
		  AND c.clusterid = clusterid_param
          AND c.cluster = (
			SELECT
				cluster
			FROM
				ride_clusters
			WHERE
				riderid = riderid_param
				AND clusterid = clusterid_param
				AND rideid = rideid_var
			)
        ORDER BY c.insertdttm
        LIMIT 1;

        -- Update the tag field in the ride_clusters table if a matching cluster is found
        IF cluster_record IS NOT NULL THEN
            UPDATE ride_clusters
            SET tag = cluster_record.name,
				color =  cluster_record.color
            WHERE riderid = riderid_param
			AND clusterid = clusterid_param
			AND rideid = rideid_var; 
        END IF;
    END LOOP;
END;
$$;


ALTER PROCEDURE public.update_ride_clusters_with_tags(IN riderid_param integer, IN clusterid_param integer) OWNER TO postgres;

--
-- Name: update_ride_levels(character, integer[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_ride_levels(gender_input character, ride_ids integer[]) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Update the level for each ride in the given ride_ids
  UPDATE rides_metric_detail rmd
  SET level = (
    SELECT rps.level
    FROM reference_powerlevels_summary rps
    WHERE rps.gender = gender_input
      AND (
        (rmd.period = 60 AND rmd.metric_value >= rps.sec0060::NUMERIC) OR
        (rmd.period = 300 AND rmd.metric_value >= rps.sec0300::NUMERIC) OR
        (rmd.period = 1200 AND rmd.metric_value >= rps.sec1200::NUMERIC)
      )
    ORDER BY rps.rank DESC
    LIMIT 1
  )
  WHERE rmd.rideid = ANY(ride_ids)
    AND rmd.metric IN ('watts', 'normalized')
    AND rmd.period IN (60, 300, 1200)
    AND EXISTS (
      SELECT 1
      FROM reference_powerlevels_summary rps
      WHERE rps.gender = gender_input
    );
END;
$$;


ALTER FUNCTION public.update_ride_levels(gender_input character, ride_ids integer[]) OWNER TO postgres;

--
-- Name: update_riderweight_avg(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.update_riderweight_avg(IN riderid_input integer)
    LANGUAGE plpgsql
    AS $$



BEGIN

    WITH AvgData AS (

        SELECT

            rw.riderid,

            rw.date,

            AVG(rw2.weight) FILTER (WHERE rw2.date >= rw.date - INTERVAL '7 days') AS weight7,

            AVG(rw2.weight) FILTER (WHERE rw2.date >= rw.date - INTERVAL '30 days') AS weight30,

            AVG(rw2.weight) FILTER (WHERE rw2.date >= rw.date - INTERVAL '365 days') AS weight365,

            AVG(rw2.bodyfatfraction) FILTER (WHERE rw2.date >= rw.date - INTERVAL '7 days') AS bodyfatfraction7,

            AVG(rw2.bodyfatfraction) FILTER (WHERE rw2.date >= rw.date - INTERVAL '30 days') AS bodyfatfraction30,

            AVG(rw2.bodyfatfraction) FILTER (WHERE rw2.date >= rw.date - INTERVAL '365 days') AS bodyfatfraction365,

            AVG(rw2.bodyh2ofraction) FILTER (WHERE rw2.date >= rw.date - INTERVAL '7 days') AS bodyh2ofraction7,

            AVG(rw2.bodyh2ofraction) FILTER (WHERE rw2.date >= rw.date - INTERVAL '30 days') AS bodyh2ofraction30,

            AVG(rw2.bodyh2ofraction) FILTER (WHERE rw2.date >= rw.date - INTERVAL '365 days') AS bodyh2ofraction365,

            EXTRACT(EPOCH FROM rw.date)::int / 86400 AS daynumber  -- Number of days since Jan 1, 1970

        FROM public.riderweight rw

        INNER JOIN public.riderweight rw2 ON rw.riderid = rw2.riderid AND rw2.date <= rw.date

        WHERE rw.riderid = riderid_input  -- Process only for the specified rider

        GROUP BY rw.riderid, rw.date

    )

    UPDATE public.riderweight rw

    SET

        weight7 = ROUND(CAST(ad.weight7 AS numeric), 1),

        weight30 =  ROUND(CAST(ad.weight30 AS numeric), 1),

        weight365 =  ROUND(CAST(ad.weight365 AS numeric), 1),

        bodyfatfraction7 =  ROUND(CAST(ad.bodyfatfraction7 AS numeric), 3),

        bodyfatfraction30 =  ROUND(CAST(ad.bodyfatfraction30 AS numeric), 3),

        bodyfatfraction365 =  ROUND(CAST(ad.bodyfatfraction365 AS numeric), 3),

        bodyh2ofraction7 =  ROUND(CAST(ad.bodyh2ofraction7 AS numeric), 3),

        bodyh2ofraction30 =  ROUND(CAST(ad.bodyh2ofraction30 AS numeric), 3),

        bodyh2ofraction365 =  ROUND(CAST(ad.bodyh2ofraction365 AS numeric), 3),

        daynumber = ad.daynumber,

        updatedttm = CURRENT_TIMESTAMP

    FROM AvgData ad

    WHERE rw.riderid = ad.riderid AND rw.date = ad.date;

END;

$$;


ALTER PROCEDURE public.update_riderweight_avg(IN riderid_input integer) OWNER TO postgres;

--
-- Name: update_run_data(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.update_run_data(IN p_riderid integer)
    LANGUAGE plpgsql
    AS $$

DECLARE

    rec RECORD;

    consecutive_days_run integer := 0;

    seven_day_run integer := 0;

    current_run_start_date date;

    current_run_end_date date;

BEGIN

    -- Reset runconsecutivedays and run7days200 to zero for the specified rider

    UPDATE cummulatives

    SET runconsecutivedays = 0, run7days200 = 0

    WHERE riderid = p_riderid;



    -- Process '1 day' consecutive runs

    FOR rec IN

        SELECT run_start_date, run_end_date, run_length

        FROM rideruns

        WHERE riderid = p_riderid AND run_type = '1 day'

        ORDER BY run_start_date

    LOOP

        -- Loop through the consecutive days within the range of each '1 day' run

        current_run_start_date := rec.run_start_date;

        current_run_end_date := rec.run_end_date;



        consecutive_days_run := 1; -- Start with 1 day for the run

        WHILE current_run_start_date <= current_run_end_date LOOP

            -- Update runconsecutivedays field in cummulatives for each date in the run

            UPDATE cummulatives

            SET runconsecutivedays = consecutive_days_run

            WHERE riderid = p_riderid AND ride_date = current_run_start_date;



            -- Increment counters and dates

            consecutive_days_run := consecutive_days_run + 1;

            current_run_start_date := current_run_start_date + INTERVAL '1 day';

        END LOOP;

    END LOOP;



    -- Process '7 day' consecutive runs

    FOR rec IN

        SELECT run_start_date, run_end_date, run_length

        FROM rideruns

        WHERE riderid = p_riderid AND run_type = '7 day'

        ORDER BY run_start_date

    LOOP

        -- Loop through the 7-day runs and update cummulatives

        current_run_start_date := rec.run_start_date;

        current_run_end_date := rec.run_end_date;



        seven_day_run := 1; -- Start with day 1 in the 7-day run

        WHILE current_run_start_date <= current_run_end_date LOOP

            -- Update run7days200 field in cummulatives for each date in the 7-day run

            UPDATE cummulatives

            SET run7days200 = seven_day_run

            WHERE riderid = p_riderid AND ride_date = current_run_start_date;



            -- Increment counters and dates

            seven_day_run := seven_day_run + 1;

            current_run_start_date := current_run_start_date + INTERVAL '1 day';

        END LOOP;

    END LOOP;



END;

$$;


ALTER PROCEDURE public.update_run_data(IN p_riderid integer) OWNER TO postgres;

--
-- Name: updateallridermetrics(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.updateallridermetrics(IN p_riderid integer)
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Call each of the existing procedures with the riderid
    CALL public.updateRideMetrics(p_riderid);
    CALL public.update_cummulatives(p_riderid);
    CALL public.metrics_by_year_month_calculate(p_riderid);
    CALL public.metrics_by_year_dow_calculate(p_riderid);
    CALL public.metrics_by_month_dom_calculate(p_riderid);
    CALL public.update_run_data(p_riderid);
    CALL public.updateridemetrics(p_riderid);
END;
$$;


ALTER PROCEDURE public.updateallridermetrics(IN p_riderid integer) OWNER TO postgres;

--
-- Name: updateridemetrics(integer); Type: PROCEDURE; Schema: public; Owner: postgres
--

CREATE PROCEDURE public.updateridemetrics(IN p_riderid integer)
    LANGUAGE plpgsql
    AS $$

DECLARE

    ftp_value NUMERIC;

BEGIN

    -- Retrieve the rider's FTP value using the getRiderProperty function

    SELECT propertyvalue INTO ftp_value

    FROM getRiderProperty(p_riderid, 'FTP')

    LIMIT 1;



    -- Guard against a zero or NULL FTP value

    IF ftp_value IS NULL OR ftp_value = 0 THEN

        RAISE EXCEPTION 'FTP value is not set or is zero for riderid %', p_riderid;

    END IF;



    -- Update intensityfactor for the rider's rides where it hasn't been set

    UPDATE rides

    SET intensityfactor = ROUND(powernormalized / ftp_value, 2)

    WHERE riderid = p_riderid

      AND powernormalized > 0

      AND (intensityfactor IS NULL OR intensityfactor = 0);



    -- Update TSS based on the calculated intensityfactor

    UPDATE rides

    SET tss = ROUND(intensityfactor * 100 * elapsedtime / (60.0 * 60.0), 0)

    WHERE riderid = p_riderid

      AND elapsedtime > 0

      AND intensityfactor > 0

      AND (tss IS NULL OR tss = 0);



END;

$$;


ALTER PROCEDURE public.updateridemetrics(IN p_riderid integer) OWNER TO postgres;

--
-- Name: usp_pace3(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.usp_pace3(p_riderid integer) RETURNS TABLE(riderdate text, distancethisyear numeric, elapsedtimethisyear numeric, elevationthisyear numeric, distancethisyeardelta numeric, elapsedtimethisyeardelta numeric, distanceperdayofyear numeric, elapsedtimeperdayofyear numeric, elevationperdayofyear numeric, distancethismonth numeric, elapsedtimethismonth numeric, elevationthismonth numeric, distancethismonthdelta numeric, elapsedtimethismonthdelta numeric, distanceperdayofmonth numeric, elapsedtimeperdayofmonth numeric, elevationperdayofmonth numeric, distancethisweek numeric, elapsedtimethisweek numeric, elevationthisweek numeric, distancethisweekdelta numeric, elapsedtimethisweekdelta numeric, distanceperdayofweek numeric, elapsedtimeperdayofweek numeric, elevationperdayofweek numeric, distancetoday numeric, elapsedtimetoday numeric, elevationtoday numeric, distancealltime numeric, elapsedtimealltime numeric, elevationalltime numeric, distanceperdayalltime numeric, elapsedtimeperdayalltime numeric, elevationperdayalltime numeric)
    LANGUAGE plpgsql
    AS $$







DECLARE

    year_target numeric := 5000.0;

    month_target numeric := 500.0;

    week_target numeric := 100.0;

    year_duration_target numeric := 300.0;

    month_duration_target numeric := 25.0;

    week_duration_target numeric := 6.0;

    timezone_offset int := 0;

    riderdate date;

    first_ride date;

    days_since_first_ride int;

    year_part int;

    month_part int;

    day_of_year numeric;

    day_of_month numeric;

    day_of_week numeric;

    days_in_year numeric;

    days_in_month numeric;

    fraction_of_year numeric;

    fraction_of_month numeric;

    fraction_of_week numeric;

    year_as_of_pace numeric;

    month_as_of_pace numeric;

    week_as_of_pace numeric;

    year_as_of_hour_pace numeric;

    month_as_of_hour_pace numeric;

    week_as_of_hour_pace numeric;

    week_start date;

    week_end date;

    distancetoday numeric;

    elevationtoday numeric;

    elapsedtimetoday numeric;

    distancethisweek numeric;

    elevationthisweek numeric;

    elapsedtimethisweek numeric;

    distancethismonth numeric;

    elevationthismonth numeric;

    elapsedtimethismonth numeric;

    distancethisyear numeric;

    elevationthisyear numeric;

    elapsedtimethisyear numeric;

    distancealltime numeric;

    elevationalltime numeric;

    elapsedtimealltime numeric;

BEGIN

    -- Set timezone offset if available

    SELECT timezoneoffset INTO timezone_offset 

    FROM riders 

    WHERE riderid = p_riderid;



    -- Get current riderdate in rider's timezone

    riderdate := (now() AT TIME ZONE 'UTC')::timestamp + interval '1 minute' * timezone_offset;



    -- Set targets from RiderGoals if available

    SELECT year, month, week INTO year_target, month_target, week_target

    FROM ridergoals

    WHERE riderid = p_riderid AND goalid = 0;



    SELECT year, month, week INTO year_duration_target, month_duration_target, week_duration_target

    FROM ridergoals

    WHERE riderid = p_riderid AND goalid = 1;



    -- Get first ride date and days since first ride

    SELECT min(date) INTO first_ride FROM rides WHERE riderid = p_riderid;

    days_since_first_ride := (riderdate - first_ride) + 1;



    -- Extract date parts

    year_part := extract(year FROM riderdate);

    month_part := extract(month FROM riderdate);

    day_of_year := extract(doy FROM riderdate);

    day_of_month := extract(day FROM riderdate);

    day_of_week := extract(dow FROM riderdate);



    -- Calculate days in year, month, week

    days_in_year := extract(doy FROM make_date(year_part + 1, 1, 1) - interval '1 day');

    days_in_month := extract(day FROM (make_date(year_part, month_part + 1, 1) - interval '1 day'));

    fraction_of_year := day_of_year / days_in_year;

    fraction_of_month := day_of_month / days_in_month;

    fraction_of_week := day_of_week / 7.0;



    -- Calculate paces

    year_as_of_pace := year_target * fraction_of_year;

    month_as_of_pace := month_target * fraction_of_month;

    week_as_of_pace := week_target * fraction_of_week;

    year_as_of_hour_pace := year_duration_target * fraction_of_year;

    month_as_of_hour_pace := month_duration_target * fraction_of_month;

    week_as_of_hour_pace := week_duration_target * fraction_of_week;



    -- Get week start and end

    SELECT max(datestart) INTO week_start

    FROM lookupweekstartandend

    WHERE datestart <= riderdate;

    week_end := week_start + interval '6 days';



    -- Day calculations

   SELECT

        round(coalesce(sum(distance), 0),1),

        coalesce(sum(elevationgain), 0),

        round(coalesce(sum(elapsedtime), 0) / 3600.0,1)

    INTO distancetoday, elevationtoday, elapsedtimetoday

    FROM rides

    WHERE riderid = p_riderid AND date_trunc('day', date) = date_trunc('day', riderdate);



    -- Week calculations

    SELECT

        round(coalesce(sum(distance), 0),1),

        coalesce(sum(elevationgain), 0),

        round(coalesce(sum(elapsedtime), 0) / 3600.0,1)

    INTO distancethisweek, elevationthisweek, elapsedtimethisweek

    FROM rides

    WHERE riderid = p_riderid AND date_trunc('day', date) BETWEEN week_start AND week_end;



    -- Month calculations

    SELECT

        round(coalesce(sum(distance), 0),1),

        coalesce(sum(elevationgain), 0),

        round(coalesce(sum(elapsedtime), 0) / 3600.0,1)

    INTO distancethismonth, elevationthismonth, elapsedtimethismonth

    FROM rides

    WHERE riderid = p_riderid AND extract(year FROM date) = year_part

    AND extract(month FROM date) = month_part;



    -- Year calculations

    SELECT

        round(coalesce(sum(distance), 0),1),

        coalesce(sum(elevationgain), 0),

        round(coalesce(sum(elapsedtime), 0) / 3600.0,1)

    INTO distancethisyear, elevationthisyear, elapsedtimethisyear

    FROM rides

    WHERE riderid = p_riderid AND extract(year FROM date) = year_part;



    -- All-time calculations

    SELECT

        round(coalesce(sum(distance), 0),1),

        round(coalesce(sum(elevationgain), 0),0),

        round(coalesce(sum(elapsedtime), 0) / 3600.0,1)

    INTO distancealltime, elevationalltime, elapsedtimealltime

    FROM rides

    WHERE riderid = p_riderid;



    -- Return final calculations

	-- Return final calculations

	RETURN QUERY

	SELECT to_char(riderdate, 'MM-DD-YYYY') AS riderdate,

       distancethisyear, elapsedtimethisyear, elevationthisyear,

       round(distancethisyear - fraction_of_year * year_target, 1) AS distancethisyeardelta,

       round(elapsedtimethisyear - fraction_of_year * year_duration_target,1) AS elapsedtimethisyeardelta,

       

       -- Protect against division by zero

       round(distancethisyear / NULLIF(day_of_year, 0), 1) AS distanceperdayofyear,

       round(elapsedtimethisyear / NULLIF(day_of_year, 0), 1) AS elapsedtimeperdayofyear,

       round(elevationthisyear / NULLIF(day_of_year, 0), 1) AS elevationperdayofyear,

       

       distancethismonth, elapsedtimethismonth, elevationthismonth,

       round(distancethismonth - fraction_of_month * month_target, 1) AS distancethismonthdelta,

       round(elapsedtimethismonth - fraction_of_month * month_duration_target, 1) AS elapsedtimethismonthdelta,

       

       -- Protect against division by zero

       round(distancethismonth / NULLIF(day_of_month, 0), 1) AS distanceperdayofmonth,

       round(elapsedtimethismonth / NULLIF(day_of_month, 0), 1) AS elapsedtimeperdayofmonth,

       round(elevationthismonth / NULLIF(day_of_month, 0), 1) AS elevationperdayofmonth,

       

       distancethisweek, elapsedtimethisweek, elevationthisweek,

       round(distancethisweek - fraction_of_week * week_target, 1) AS distancethisweekdelta,

       round(elapsedtimethisweek - fraction_of_week * week_duration_target, 1) AS elapsedtimethisweekdelta,

       

       -- Protect against division by zero

       round(distancethisweek / NULLIF(day_of_week, 0), 1) AS distanceperdayofweek,

       round(elapsedtimethisweek / NULLIF(day_of_week, 0), 1) AS elapsedtimeperdayofweek,

       round(elevationthisweek / NULLIF(day_of_week, 0), 1) AS elevationperdayofweek,

       

       distancetoday, elapsedtimetoday, elevationtoday,

       distancealltime, elapsedtimealltime, elevationalltime,

       

       -- Protect against division by zero

       round(distancealltime / NULLIF(days_since_first_ride, 0), 2) AS distanceperdayalltime,

       round(elapsedtimealltime / NULLIF(days_since_first_ride, 0), 2) AS elapsedtimeperdayalltime,

       round(elevationalltime / NULLIF(days_since_first_ride, 0), 0) AS elevationperdayalltime;

END;

$$;


ALTER FUNCTION public.usp_pace3(p_riderid integer) OWNER TO postgres;

--
-- Name: accounts_accountid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.accounts_accountid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.accounts_accountid_seq OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.accounts (
    accountid integer DEFAULT nextval('public.accounts_accountid_seq'::regclass) NOT NULL,
    name character varying(25) NOT NULL,
    description character varying(100),
    enabled smallint DEFAULT 1 NOT NULL,
    accounttype integer DEFAULT 0 NOT NULL,
    subdomain character varying(50),
    domain character varying(100),
    insertby character varying(50) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    logoimage character varying(500)
);


ALTER TABLE public.accounts OWNER TO postgres;

--
-- Name: bikes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bikes (
    bikeid integer NOT NULL,
    riderid integer NOT NULL,
    bikename character varying(20) NOT NULL,
    brand character varying(20),
    make character varying(20),
    isdefault smallint,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    retired smallint NOT NULL,
    stravaname character varying(20),
    stravaid character varying(20)
);


ALTER TABLE public.bikes OWNER TO postgres;

--
-- Name: bikes_bikeid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bikes_bikeid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bikes_bikeid_seq OWNER TO postgres;

--
-- Name: bikes_bikeid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bikes_bikeid_seq OWNED BY public.bikes.bikeid;


--
-- Name: bikes_bikeid_seq1; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bikes_bikeid_seq1
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bikes_bikeid_seq1 OWNER TO postgres;

--
-- Name: bikes_bikeid_seq1; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bikes_bikeid_seq1 OWNED BY public.bikes.bikeid;


--
-- Name: bikes_components; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bikes_components (
    bikecomponentid integer NOT NULL,
    bikeid integer NOT NULL,
    componentid integer NOT NULL,
    startdate timestamp without time zone,
    enddate timestamp without time zone,
    insertdttm timestamp without time zone
);


ALTER TABLE public.bikes_components OWNER TO postgres;

--
-- Name: bikes_components_bikecomponentid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bikes_components_bikecomponentid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bikes_components_bikecomponentid_seq OWNER TO postgres;

--
-- Name: bikes_components_bikecomponentid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bikes_components_bikecomponentid_seq OWNED BY public.bikes_components.bikecomponentid;


--
-- Name: calendarlookup; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.calendarlookup (
    number integer NOT NULL,
    date timestamp without time zone,
    dayofyear integer,
    year integer,
    dayofmonth integer,
    month integer
);


ALTER TABLE public.calendarlookup OWNER TO postgres;

--
-- Name: calendarlookup_number_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.calendarlookup_number_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.calendarlookup_number_seq OWNER TO postgres;

--
-- Name: calendarlookup_number_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.calendarlookup_number_seq OWNED BY public.calendarlookup.number;


--
-- Name: cluster_centroids; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cluster_centroids (
    riderid integer NOT NULL,
    clusterid integer NOT NULL,
    cluster integer NOT NULL,
    distance numeric,
    speedavg numeric,
    elevationgain numeric,
    hravg numeric,
    powernormalized numeric,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    name text,
    distance_n numeric DEFAULT 0.0,
    speedavg_n numeric DEFAULT 0.0,
    elevationgain_n numeric DEFAULT 0.0,
    hravg_n numeric DEFAULT 0.0,
    powernormalized_n numeric DEFAULT 0.0,
    color text DEFAULT '#FF0000'::text
);


ALTER TABLE public.cluster_centroids OWNER TO postgres;

--
-- Name: clusters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.clusters (
    clusterid integer NOT NULL,
    riderid integer NOT NULL,
    startyear integer NOT NULL,
    endyear integer NOT NULL,
    clustercount integer NOT NULL,
    fields text,
    active boolean DEFAULT true,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.clusters OWNER TO postgres;

--
-- Name: clusters_clusterid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.clusters ALTER COLUMN clusterid ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.clusters_clusterid_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: component_notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.component_notifications (
    component_notificationid integer NOT NULL,
    component_notificationtypeid integer NOT NULL,
    componentid integer NOT NULL,
    delivered smallint DEFAULT 0 NOT NULL,
    insertdttm timestamp without time zone
);


ALTER TABLE public.component_notifications OWNER TO postgres;

--
-- Name: component_notifications_component_notificationid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.component_notifications_component_notificationid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.component_notifications_component_notificationid_seq OWNER TO postgres;

--
-- Name: component_notifications_component_notificationid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.component_notifications_component_notificationid_seq OWNED BY public.component_notifications.component_notificationid;


--
-- Name: component_notificationtype; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.component_notificationtype (
    component_notificationtypeid integer NOT NULL,
    targetpercent double precision NOT NULL,
    name character varying(50) NOT NULL,
    insertdttm timestamp without time zone
);


ALTER TABLE public.component_notificationtype OWNER TO postgres;

--
-- Name: component_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.component_results (
    componentid integer NOT NULL,
    riderid integer NOT NULL,
    name character varying(50),
    description character varying(50),
    brand character varying(20),
    model character varying(20),
    bikes character varying(200),
    targethours double precision,
    targetdistance double precision DEFAULT 0,
    targetcalendardays double precision DEFAULT 0,
    ridecount integer DEFAULT 0,
    elapsedtime double precision DEFAULT 0,
    distance double precision DEFAULT 0,
    calendardays double precision DEFAULT 0,
    pcttime double precision DEFAULT 0.0,
    pctdistance double precision DEFAULT 0.0,
    pctcalendardays double precision DEFAULT 0.0,
    firstuse timestamp without time zone,
    lastuse timestamp without time zone,
    dateretired timestamp without time zone,
    reasonretired character varying(50)
);


ALTER TABLE public.component_results OWNER TO postgres;

--
-- Name: componentretired_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.componentretired_results (
    componentid integer NOT NULL,
    riderid integer NOT NULL,
    name character varying(50),
    description character varying(50),
    brand character varying(20),
    model character varying(20),
    bikes character varying(200),
    targethours double precision DEFAULT 0,
    targetdistance double precision DEFAULT 0,
    targetcalendardays double precision DEFAULT 0,
    ridecount integer DEFAULT 0,
    elapsedtime double precision DEFAULT 0,
    distance double precision DEFAULT 0,
    calendardays double precision DEFAULT 0,
    pcttime double precision DEFAULT 0,
    pctdistance double precision DEFAULT 0.0,
    pctcalendardays double precision DEFAULT 0.0,
    firstuse timestamp without time zone,
    lastuse timestamp without time zone,
    dateretired timestamp without time zone,
    reasonretired character varying(50)
);


ALTER TABLE public.componentretired_results OWNER TO postgres;

--
-- Name: components; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.components (
    componentid integer NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(50),
    riderid integer NOT NULL,
    active smallint DEFAULT 0 NOT NULL,
    brand character varying(20),
    model character varying(20),
    insertdttm timestamp without time zone,
    targethours double precision DEFAULT 0,
    targetdistance double precision DEFAULT 0,
    dateretired timestamp without time zone,
    reasonretired character varying(50),
    targetcalendardays double precision
);


ALTER TABLE public.components OWNER TO postgres;

--
-- Name: components_componentid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.components_componentid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.components_componentid_seq OWNER TO postgres;

--
-- Name: components_componentid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.components_componentid_seq OWNED BY public.components.componentid;


--
-- Name: cummulatives; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cummulatives (
    riderid integer NOT NULL,
    ride_date date NOT NULL,
    moving_total_distance1 numeric,
    moving_total_elevationgain1 numeric,
    moving_total_elapsedtime1 numeric,
    moving_hr_average1 numeric,
    moving_power_average1 numeric,
    moving_total_distance7 numeric,
    moving_total_elevationgain7 numeric,
    moving_total_elapsedtime7 numeric,
    moving_hr_average7 numeric,
    moving_power_average7 numeric,
    moving_total_distance30 numeric,
    moving_total_elevationgain30 numeric,
    moving_total_elapsedtime30 numeric,
    moving_hr_average30 numeric,
    moving_power_average30 numeric,
    moving_total_distance365 numeric,
    moving_total_elevationgain365 numeric,
    moving_total_elapsedtime365 numeric,
    moving_hr_average365 numeric,
    moving_power_average365 numeric,
    moving_total_distancealltime numeric,
    moving_total_elevationgainalltime numeric,
    moving_total_elapsedtimealltime numeric,
    moving_hr_averagealltime numeric,
    moving_power_averagealltime numeric,
    total_tss numeric,
    fatigue numeric,
    fitness numeric,
    form numeric,
    tss30 numeric,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    runconsecutivedays integer DEFAULT 0,
    run7days200 integer DEFAULT 0
);


ALTER TABLE public.cummulatives OWNER TO postgres;

--
-- Name: datedimension; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.datedimension (
    datekey integer NOT NULL,
    date date NOT NULL,
    day smallint NOT NULL,
    daysuffix character(2) NOT NULL,
    weekday smallint NOT NULL,
    weekdayname character varying(10) NOT NULL,
    isweekend smallint NOT NULL,
    isholiday smallint NOT NULL,
    holidaytext character varying(64),
    dowinmonth smallint NOT NULL,
    dayofyear smallint NOT NULL,
    weekofmonth smallint NOT NULL,
    weekofyear smallint NOT NULL,
    isoweekofyear smallint NOT NULL,
    month smallint NOT NULL,
    monthname character varying(10) NOT NULL,
    quarter smallint NOT NULL,
    quartername character varying(6) NOT NULL,
    year integer NOT NULL,
    mmyyyy character(6) NOT NULL,
    monthyear character(7) NOT NULL,
    firstdayofmonth date NOT NULL,
    lastdayofmonth date NOT NULL,
    firstdayofquarter date NOT NULL,
    lastdayofquarter date NOT NULL,
    firstdayofyear date NOT NULL,
    lastdayofyear date NOT NULL,
    firstdayofnextmonth date NOT NULL,
    firstdayofnextyear date NOT NULL
);


ALTER TABLE public.datedimension OWNER TO postgres;

--
-- Name: lookupdays; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lookupdays (
    month integer NOT NULL,
    daysbefore integer
);


ALTER TABLE public.lookupdays OWNER TO postgres;

--
-- Name: lookupweekstartandend; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lookupweekstartandend (
    weekid integer NOT NULL,
    datestart timestamp without time zone NOT NULL
);


ALTER TABLE public.lookupweekstartandend OWNER TO postgres;

--
-- Name: lookupweekstartandend_weekid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lookupweekstartandend_weekid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lookupweekstartandend_weekid_seq OWNER TO postgres;

--
-- Name: lookupweekstartandend_weekid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lookupweekstartandend_weekid_seq OWNED BY public.lookupweekstartandend.weekid;


--
-- Name: metrics_by_month_dom; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.metrics_by_month_dom (
    riderid integer NOT NULL,
    dom integer NOT NULL,
    distancejan numeric,
    distancefeb numeric,
    distancemar numeric,
    distanceapr numeric,
    distancemay numeric,
    distancejun numeric,
    distancejul numeric,
    distanceaug numeric,
    distancesep numeric,
    distanceoct numeric,
    distancenov numeric,
    distancedec numeric,
    distance numeric,
    elevationgainjan numeric,
    elevationgainfeb numeric,
    elevationgainmar numeric,
    elevationgainapr numeric,
    elevationgainmay numeric,
    elevationgainjun numeric,
    elevationgainjul numeric,
    elevationgainaug numeric,
    elevationgainsep numeric,
    elevationgainoct numeric,
    elevationgainnov numeric,
    elevationgaindec numeric,
    elevationgain numeric,
    elapsedtimejan numeric,
    elapsedtimefeb numeric,
    elapsedtimemar numeric,
    elapsedtimeapr numeric,
    elapsedtimemay numeric,
    elapsedtimejun numeric,
    elapsedtimejul numeric,
    elapsedtimeaug numeric,
    elapsedtimesep numeric,
    elapsedtimeoct numeric,
    elapsedtimenov numeric,
    elapsedtimedec numeric,
    elapsedtime numeric,
    hraveragejan numeric,
    hraveragefeb numeric,
    hraveragemar numeric,
    hraverageapr numeric,
    hraveragemay numeric,
    hraveragejun numeric,
    hraveragejul numeric,
    hraverageaug numeric,
    hraveragesep numeric,
    hraverageoct numeric,
    hraveragenov numeric,
    hraveragedec numeric,
    hraverage numeric,
    poweraveragejan numeric,
    poweraveragefeb numeric,
    poweraveragemar numeric,
    poweraverageapr numeric,
    poweraveragemay numeric,
    poweraveragejun numeric,
    poweraveragejul numeric,
    poweraverageaug numeric,
    poweraveragesep numeric,
    poweraverageoct numeric,
    poweraveragenov numeric,
    poweraveragedec numeric,
    poweraverage numeric
);


ALTER TABLE public.metrics_by_month_dom OWNER TO postgres;

--
-- Name: metrics_by_year_dow; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.metrics_by_year_dow (
    riderid integer NOT NULL,
    year integer NOT NULL,
    distancemonday numeric,
    distancetuesday numeric,
    distancewednesday numeric,
    distancethursday numeric,
    distancefriday numeric,
    distancesaturday numeric,
    distancesunday numeric,
    distance numeric,
    elevationgainmonday numeric,
    elevationgaintuesday numeric,
    elevationgainwednesday numeric,
    elevationgainthursday numeric,
    elevationgainfriday numeric,
    elevationgainsaturday numeric,
    elevationgainsunday numeric,
    elevationgain numeric,
    elapsedtimemonday numeric,
    elapsedtimetuesday numeric,
    elapsedtimewednesday numeric,
    elapsedtimethursday numeric,
    elapsedtimefriday numeric,
    elapsedtimesaturday numeric,
    elapsedtimesunday numeric,
    elapsedtime numeric,
    hraveragemonday numeric,
    hraveragetuesday numeric,
    hraveragewednesday numeric,
    hraveragethursday numeric,
    hraveragefriday numeric,
    hraveragesaturday numeric,
    hraveragesunday numeric,
    hraverage numeric,
    poweraveragemonday numeric,
    poweraveragetuesday numeric,
    poweraveragewednesday numeric,
    poweraveragethursday numeric,
    poweraveragefriday numeric,
    poweraveragesaturday numeric,
    poweraveragesunday numeric,
    poweraverage numeric
);


ALTER TABLE public.metrics_by_year_dow OWNER TO postgres;

--
-- Name: metrics_by_year_month; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.metrics_by_year_month (
    riderid integer NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    month_name text NOT NULL,
    total_distance numeric(10,1) NOT NULL,
    avg_speedavg numeric(10,1) NOT NULL,
    max_speedmax numeric(10,1) NOT NULL,
    avg_cadence integer NOT NULL,
    avg_hravg integer NOT NULL,
    max_hrmax integer NOT NULL,
    avg_poweravg integer NOT NULL,
    max_powermax integer NOT NULL,
    total_elevationgain integer NOT NULL,
    total_elapsedtime_hours numeric(10,1) NOT NULL,
    avg_powernormalized integer NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.metrics_by_year_month OWNER TO postgres;

--
-- Name: ocdcyclistconstants_constantid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ocdcyclistconstants_constantid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ocdcyclistconstants_constantid_seq OWNER TO postgres;

--
-- Name: ocdcyclistconstants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ocdcyclistconstants (
    constantid integer DEFAULT nextval('public.ocdcyclistconstants_constantid_seq'::regclass) NOT NULL,
    constantname character varying(50) NOT NULL,
    constantvaluestring character varying(500) NOT NULL,
    insertby character varying(50) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updateby character varying(50) NOT NULL,
    updatedttm timestamp without time zone NOT NULL,
    account integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.ocdcyclistconstants OWNER TO postgres;

--
-- Name: ocdrideconstants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ocdrideconstants (
    ocdconstantid integer NOT NULL,
    name character varying(20) NOT NULL,
    minmeterspersecond double precision DEFAULT 1.34 NOT NULL,
    minrecognizedhr double precision DEFAULT 30.0 NOT NULL,
    maxrecognizedhr double precision DEFAULT 250.0 NOT NULL,
    minrecognizedcadence double precision DEFAULT 30.0 NOT NULL,
    maxrecognizedcadence double precision DEFAULT 150.0 NOT NULL,
    minrecognizedpower double precision DEFAULT 30.0 NOT NULL,
    maxrecognizedpower double precision DEFAULT 2000.0 NOT NULL
);


ALTER TABLE public.ocdrideconstants OWNER TO postgres;

--
-- Name: ocdrideconstants_ocdconstantid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ocdrideconstants_ocdconstantid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ocdrideconstants_ocdconstantid_seq OWNER TO postgres;

--
-- Name: ocdrideconstants_ocdconstantid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ocdrideconstants_ocdconstantid_seq OWNED BY public.ocdrideconstants.ocdconstantid;


--
-- Name: placedistances; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.placedistances (
    rowid integer NOT NULL,
    startplaceid integer NOT NULL,
    endplaceid integer NOT NULL,
    distance double precision NOT NULL
);


ALTER TABLE public.placedistances OWNER TO postgres;

--
-- Name: placedistances_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.placedistances_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.placedistances_rowid_seq OWNER TO postgres;

--
-- Name: placedistances_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.placedistances_rowid_seq OWNED BY public.placedistances.rowid;


--
-- Name: places; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.places (
    placeid integer NOT NULL,
    placename character varying(50) NOT NULL,
    latitude double precision,
    longitude double precision
);


ALTER TABLE public.places OWNER TO postgres;

--
-- Name: places_placeid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.places_placeid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.places_placeid_seq OWNER TO postgres;

--
-- Name: places_placeid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.places_placeid_seq OWNED BY public.places.placeid;


--
-- Name: power_curve; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.power_curve (
    riderid integer NOT NULL,
    duration_seconds integer NOT NULL,
    max_power_watts numeric(6,2) NOT NULL,
    max_power_wkg numeric(5,2) NOT NULL,
    period text NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    rideid integer
);


ALTER TABLE public.power_curve OWNER TO postgres;

--
-- Name: reference_powerlevels; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reference_powerlevels (
    rowid integer NOT NULL,
    level character varying(50) NOT NULL,
    period5sec double precision NOT NULL,
    period60sec double precision NOT NULL,
    period300sec double precision NOT NULL,
    period1200sec double precision NOT NULL,
    gender character(1)
);


ALTER TABLE public.reference_powerlevels OWNER TO postgres;

--
-- Name: reference_powerlevels_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reference_powerlevels_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reference_powerlevels_rowid_seq OWNER TO postgres;

--
-- Name: reference_powerlevels_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reference_powerlevels_rowid_seq OWNED BY public.reference_powerlevels.rowid;


--
-- Name: reference_powerlevels_summary; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reference_powerlevels_summary (
    level character varying(50) NOT NULL,
    gender character(1) NOT NULL,
    rank integer NOT NULL,
    sec0005 double precision NOT NULL,
    sec0060 double precision NOT NULL,
    sec0300 double precision NOT NULL,
    sec1200 double precision NOT NULL
);


ALTER TABLE public.reference_powerlevels_summary OWNER TO postgres;

--
-- Name: ride_clusters; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ride_clusters (
    riderid integer NOT NULL,
    rideid integer NOT NULL,
    cluster integer NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    tag character varying(15),
    clusterid integer NOT NULL,
    color character varying(15) DEFAULT '#0000FF'::character varying
);


ALTER TABLE public.ride_clusters OWNER TO postgres;

--
-- Name: ride_metrics_binary; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ride_metrics_binary (
    rideid integer NOT NULL,
    watts bytea,
    heartrate bytea,
    cadence bytea,
    velocity_smooth bytea,
    altitude bytea,
    distance bytea,
    temperature bytea,
    location bytea,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    power_curve bytea,
    "time" bytea
);


ALTER TABLE public.ride_metrics_binary OWNER TO postgres;

--
-- Name: rideprofiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rideprofiles (
    rideid integer NOT NULL,
    updateby character varying(50) NOT NULL,
    updatedttm timestamp without time zone NOT NULL
);


ALTER TABLE public.rideprofiles OWNER TO postgres;

--
-- Name: rideprofilesegmentefforts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rideprofilesegmentefforts (
    rideid integer NOT NULL,
    segmenteffortid bigint NOT NULL,
    updateby character varying(50) NOT NULL,
    updatedttm timestamp without time zone NOT NULL
);


ALTER TABLE public.rideprofilesegmentefforts OWNER TO postgres;

--
-- Name: rideproperties; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rideproperties (
    rowid integer NOT NULL,
    rideid integer NOT NULL,
    property character varying(50) NOT NULL,
    propertyvalue text NOT NULL,
    updatedttm timestamp without time zone NOT NULL
);


ALTER TABLE public.rideproperties OWNER TO postgres;

--
-- Name: rideproperties_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rideproperties_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rideproperties_rowid_seq OWNER TO postgres;

--
-- Name: rideproperties_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rideproperties_rowid_seq OWNED BY public.rideproperties.rowid;


--
-- Name: rider_goal_summary; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rider_goal_summary (
    summary_id integer NOT NULL,
    riderid integer NOT NULL,
    date text NOT NULL,
    miles_today_actual numeric,
    elevation_today_actual numeric,
    time_today_actual numeric,
    miles_week_actual numeric,
    miles_week_target numeric,
    miles_week_delta numeric,
    miles_week_perday numeric,
    elevation_week_actual numeric,
    time_week_actual numeric,
    time_week_target numeric,
    time_week_delta numeric,
    time_week_perday numeric,
    miles_month_actual numeric,
    miles_month_target numeric,
    miles_month_delta numeric,
    miles_month_perday numeric,
    elevation_month_actual numeric,
    time_month_actual numeric,
    time_month_target numeric,
    time_month_delta numeric,
    time_month_perday numeric,
    miles_year_actual numeric,
    miles_year_target numeric,
    miles_year_delta numeric,
    miles_year_perday numeric,
    elevation_year_actual numeric,
    time_year_actual numeric,
    time_year_target numeric,
    time_year_delta numeric,
    time_year_perday numeric,
    miles_alltime_actual numeric,
    elevation_alltime_actual numeric,
    time_alltime_actual numeric,
    miles_alltime_perday numeric,
    elevation_alltime_perday numeric,
    time_alltime_perday numeric,
    total_days_alltime integer,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.rider_goal_summary OWNER TO postgres;

--
-- Name: rider_goal_summary_summary_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rider_goal_summary_summary_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rider_goal_summary_summary_id_seq OWNER TO postgres;

--
-- Name: rider_goal_summary_summary_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rider_goal_summary_summary_id_seq OWNED BY public.rider_goal_summary.summary_id;


--
-- Name: rider_match_definition; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rider_match_definition (
    riderid integer NOT NULL,
    type text NOT NULL,
    period integer NOT NULL,
    targetftp integer NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.rider_match_definition OWNER TO postgres;

--
-- Name: ridergoals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ridergoals (
    ridergoalid integer NOT NULL,
    riderid integer NOT NULL,
    week double precision NOT NULL,
    month double precision NOT NULL,
    year double precision NOT NULL,
    goalid integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.ridergoals OWNER TO postgres;

--
-- Name: ridergoals_ridergoalid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ridergoals_ridergoalid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ridergoals_ridergoalid_seq OWNER TO postgres;

--
-- Name: ridergoals_ridergoalid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ridergoals_ridergoalid_seq OWNED BY public.ridergoals.ridergoalid;


--
-- Name: ridernotifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ridernotifications (
    rowid integer NOT NULL,
    riderid integer NOT NULL,
    typeid smallint NOT NULL,
    viewed smallint NOT NULL,
    notification character varying(255) NOT NULL,
    action character varying(255),
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.ridernotifications OWNER TO postgres;

--
-- Name: ridernotifications_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ridernotifications_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ridernotifications_rowid_seq OWNER TO postgres;

--
-- Name: ridernotifications_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ridernotifications_rowid_seq OWNED BY public.ridernotifications.rowid;


--
-- Name: ridernotificationtypes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ridernotificationtypes (
    typeid smallint NOT NULL,
    name character varying(25) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    insertby character varying(50) NOT NULL
);


ALTER TABLE public.ridernotificationtypes OWNER TO postgres;

--
-- Name: riderpropertyvalues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.riderpropertyvalues (
    propertyid integer NOT NULL,
    riderid integer NOT NULL,
    property character varying(20) NOT NULL,
    date timestamp without time zone NOT NULL,
    propertyvaluestring text,
    propertyvalue numeric
);


ALTER TABLE public.riderpropertyvalues OWNER TO postgres;

--
-- Name: riderpropertyvalues_propertyid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.riderpropertyvalues_propertyid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.riderpropertyvalues_propertyid_seq OWNER TO postgres;

--
-- Name: riderpropertyvalues_propertyid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.riderpropertyvalues_propertyid_seq OWNED BY public.riderpropertyvalues.propertyid;


--
-- Name: riderrideclusterrideassignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.riderrideclusterrideassignments (
    riderrideclusterid integer NOT NULL,
    rideid integer NOT NULL,
    cluster smallint NOT NULL,
    name character varying(20) NOT NULL,
    color character varying(10) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.riderrideclusterrideassignments OWNER TO postgres;

--
-- Name: riders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.riders (
    riderid integer NOT NULL,
    username character varying(255) NOT NULL,
    email character varying(128) NOT NULL,
    password character varying(128) NOT NULL,
    passwordquestion character varying(255),
    passwordanswer character varying(255),
    isapproved smallint,
    lastactivitydate timestamp without time zone,
    lastlogindate timestamp without time zone,
    lastpasswordchangeddate timestamp without time zone,
    creationdate timestamp without time zone,
    isonline smallint,
    islockedout smallint,
    headshot character varying(500),
    timezoneoffset integer,
    athlete_id integer
);


ALTER TABLE public.riders OWNER TO postgres;

--
-- Name: riders_riderid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.riders_riderid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.riders_riderid_seq OWNER TO postgres;

--
-- Name: riders_riderid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.riders_riderid_seq OWNED BY public.riders.riderid;


--
-- Name: riders_riderid_seq1; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.riders_riderid_seq1
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.riders_riderid_seq1 OWNER TO postgres;

--
-- Name: riders_riderid_seq1; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.riders_riderid_seq1 OWNED BY public.riders.riderid;


--
-- Name: rideruns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rideruns (
    riderid integer NOT NULL,
    riderunid integer NOT NULL,
    run_type text NOT NULL,
    run_start_date date NOT NULL,
    run_end_date date NOT NULL,
    run_length integer NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.rideruns OWNER TO postgres;

--
-- Name: rideruns_riderunid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rideruns_riderunid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rideruns_riderunid_seq OWNER TO postgres;

--
-- Name: rideruns_riderunid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rideruns_riderunid_seq OWNED BY public.rideruns.riderunid;


--
-- Name: riderweight; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.riderweight (
    riderid integer NOT NULL,
    date timestamp without time zone NOT NULL,
    weight real NOT NULL,
    weight7 real,
    weight30 real,
    weight365 real,
    daynumber smallint,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updatedttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    bodyfatfraction real DEFAULT 0.0,
    bodyh2ofraction real DEFAULT 0.0,
    bodyfatfraction7 real DEFAULT 0.0,
    bodyfatfraction30 real DEFAULT 0.0,
    bodyfatfraction365 real DEFAULT 0.0,
    bodyh2ofraction7 real DEFAULT 0.0,
    bodyh2ofraction30 real DEFAULT 0.0,
    bodyh2ofraction365 real DEFAULT 0.0
);


ALTER TABLE public.riderweight OWNER TO postgres;

--
-- Name: riderzones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.riderzones (
    riderzoneid integer NOT NULL,
    riderid integer NOT NULL,
    zonetype character varying(10),
    zonevalues character varying(50)
);


ALTER TABLE public.riderzones OWNER TO postgres;

--
-- Name: riderzones_riderzoneid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.riderzones_riderzoneid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.riderzones_riderzoneid_seq OWNER TO postgres;

--
-- Name: riderzones_riderzoneid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.riderzones_riderzoneid_seq OWNED BY public.riderzones.riderzoneid;


--
-- Name: rides; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides (
    rideid integer NOT NULL,
    riderid integer NOT NULL,
    date timestamp without time zone NOT NULL,
    distance numeric DEFAULT 0.0 NOT NULL,
    speedavg numeric DEFAULT 0.0 NOT NULL,
    speedmax numeric DEFAULT 0.0 NOT NULL,
    cadence numeric DEFAULT 0.0,
    hravg integer DEFAULT 0.0,
    hrmax integer DEFAULT 0.0,
    title text,
    poweravg integer DEFAULT 0.0,
    powermax integer DEFAULT 0.0,
    bikeid integer,
    stravaid bigint,
    comment text,
    elevationgain numeric DEFAULT 0.0,
    elapsedtime integer,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    hasdetail smallint,
    powernormalized integer,
    intensityfactor numeric DEFAULT 0.0,
    tss integer,
    matches smallint,
    trainer smallint NOT NULL,
    elevationloss numeric DEFAULT 0.0,
    datenotime timestamp without time zone,
    device_name character varying(30),
    fracdim numeric DEFAULT 0.0,
    datefrac date GENERATED ALWAYS AS ((date)::date) STORED,
    hrzones integer[],
    powerzones integer[],
    cadencezones integer[]
)
WITH (autovacuum_enabled='true');


ALTER TABLE public.rides OWNER TO postgres;

--
-- Name: rides_boundingbox; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_boundingbox (
    rideid integer NOT NULL,
    minlatitude double precision NOT NULL,
    minlongitude double precision NOT NULL,
    maxlatitude double precision NOT NULL,
    maxlongitude double precision NOT NULL,
    centerlatitude double precision,
    centerlongitude double precision
);


ALTER TABLE public.rides_boundingbox OWNER TO postgres;

--
-- Name: rides_hrdetail; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_hrdetail (
    ridehrid integer NOT NULL,
    rideid integer NOT NULL,
    period integer,
    peakhr integer DEFAULT 0 NOT NULL,
    clocktime timestamp without time zone NOT NULL
);


ALTER TABLE public.rides_hrdetail OWNER TO postgres;

--
-- Name: rides_hrdetail_ridehrid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rides_hrdetail_ridehrid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rides_hrdetail_ridehrid_seq OWNER TO postgres;

--
-- Name: rides_hrdetail_ridehrid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rides_hrdetail_ridehrid_seq OWNED BY public.rides_hrdetail.ridehrid;


--
-- Name: rides_imputeddata; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_imputeddata (
    rideid integer NOT NULL,
    rideidsource integer NOT NULL
);


ALTER TABLE public.rides_imputeddata OWNER TO postgres;

--
-- Name: rides_matches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_matches (
    ridematchid integer NOT NULL,
    rideid integer NOT NULL,
    fractionofthreshold double precision NOT NULL,
    minimumperiod integer NOT NULL,
    actualperiod integer NOT NULL,
    startclocktime timestamp without time zone NOT NULL,
    peakpower integer NOT NULL,
    averagepower integer NOT NULL
);


ALTER TABLE public.rides_matches OWNER TO postgres;

--
-- Name: rides_matches_new; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_matches_new (
    rideid integer NOT NULL,
    type text NOT NULL,
    period integer NOT NULL,
    targetftp integer NOT NULL,
    startindex integer DEFAULT 0 NOT NULL,
    actualperiod integer NOT NULL,
    maxaveragepower integer NOT NULL,
    averagepower integer NOT NULL,
    peakpower integer NOT NULL,
    averageheartrate integer NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.rides_matches_new OWNER TO postgres;

--
-- Name: rides_matches_ridematchid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rides_matches_ridematchid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rides_matches_ridematchid_seq OWNER TO postgres;

--
-- Name: rides_matches_ridematchid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rides_matches_ridematchid_seq OWNED BY public.rides_matches.ridematchid;


--
-- Name: rides_metric_detail; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_metric_detail (
    rideid integer NOT NULL,
    metric text NOT NULL,
    period integer NOT NULL,
    metric_value numeric DEFAULT 0 NOT NULL,
    startindex integer DEFAULT 0 NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    level text
);


ALTER TABLE public.rides_metric_detail OWNER TO postgres;

--
-- Name: rides_powerdetail; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_powerdetail (
    ridepowerid integer NOT NULL,
    rideid integer NOT NULL,
    period integer,
    peakpower smallint DEFAULT 0 NOT NULL,
    clocktime timestamp without time zone NOT NULL,
    wattsperkg double precision
);


ALTER TABLE public.rides_powerdetail OWNER TO postgres;

--
-- Name: rides_powerdetail_ridepowerid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rides_powerdetail_ridepowerid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rides_powerdetail_ridepowerid_seq OWNER TO postgres;

--
-- Name: rides_powerdetail_ridepowerid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rides_powerdetail_ridepowerid_seq OWNED BY public.rides_powerdetail.ridepowerid;


--
-- Name: rides_powerprofile_bestefforts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_powerprofile_bestefforts (
    powerprofileid integer NOT NULL,
    riderid integer,
    rangetype integer,
    period integer,
    power integer,
    powerperkg double precision,
    level character varying(50),
    rideid integer,
    clocktime timestamp without time zone,
    weight double precision
);


ALTER TABLE public.rides_powerprofile_bestefforts OWNER TO postgres;

--
-- Name: rides_powerprofile_bestefforts_powerprofileid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rides_powerprofile_bestefforts_powerprofileid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rides_powerprofile_bestefforts_powerprofileid_seq OWNER TO postgres;

--
-- Name: rides_powerprofile_bestefforts_powerprofileid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rides_powerprofile_bestefforts_powerprofileid_seq OWNED BY public.rides_powerprofile_bestefforts.powerprofileid;


--
-- Name: rides_rideid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rides_rideid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rides_rideid_seq OWNER TO postgres;

--
-- Name: rides_rideid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rides_rideid_seq OWNED BY public.rides.rideid;


--
-- Name: rides_rideid_seq1; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rides_rideid_seq1
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rides_rideid_seq1 OWNER TO postgres;

--
-- Name: rides_rideid_seq1; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rides_rideid_seq1 OWNED BY public.rides.rideid;


--
-- Name: rides_streams; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rides_streams (
    rideid integer NOT NULL,
    stravaid bigint NOT NULL,
    filename text,
    streams text,
    processed boolean DEFAULT false,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    processdttm timestamp without time zone
);


ALTER TABLE public.rides_streams OWNER TO postgres;

--
-- Name: ridestoprocess; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ridestoprocess (
    process integer NOT NULL,
    riderid integer NOT NULL,
    rideid integer NOT NULL,
    processed smallint DEFAULT 0 NOT NULL,
    updatedttm timestamp without time zone
);


ALTER TABLE public.ridestoprocess OWNER TO postgres;

--
-- Name: routepoints; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.routepoints (
    routepointid integer NOT NULL,
    routeid integer NOT NULL,
    name character varying(25) NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    cummulative double precision,
    leg double precision
);


ALTER TABLE public.routepoints OWNER TO postgres;

--
-- Name: routepoints_routepointid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.routepoints_routepointid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.routepoints_routepointid_seq OWNER TO postgres;

--
-- Name: routepoints_routepointid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.routepoints_routepointid_seq OWNED BY public.routepoints.routepointid;


--
-- Name: routes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.routes (
    routeid integer NOT NULL,
    routename character varying(25) NOT NULL,
    routedescription character varying(100) NOT NULL
);


ALTER TABLE public.routes OWNER TO postgres;

--
-- Name: routes_routeid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.routes_routeid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.routes_routeid_seq OWNER TO postgres;

--
-- Name: routes_routeid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.routes_routeid_seq OWNED BY public.routes.routeid;


--
-- Name: segmentgroups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.segmentgroups (
    segmentgroup character varying(50) NOT NULL,
    stravaid bigint,
    segmentid integer,
    lastupdatedttm timestamp without time zone,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.segmentgroups OWNER TO postgres;

--
-- Name: segmentsstrava; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.segmentsstrava (
    riderid integer NOT NULL,
    id bigint NOT NULL,
    name character varying(200) DEFAULT 'No Name'::character varying NOT NULL,
    distance double precision DEFAULT 0.0 NOT NULL,
    average_grade double precision DEFAULT 0.0 NOT NULL,
    maximum_grade double precision DEFAULT 0.0 NOT NULL,
    elevation_high double precision DEFAULT 0.0 NOT NULL,
    elevation_low double precision DEFAULT 0.0 NOT NULL,
    start_latitude double precision DEFAULT 0.0 NOT NULL,
    start_longitude double precision DEFAULT 0.0 NOT NULL,
    end_latitude double precision DEFAULT 0.0 NOT NULL,
    end_longitude double precision DEFAULT 0.0 NOT NULL,
    climb_category integer NOT NULL,
    total_elevation_gain double precision DEFAULT 0.0 NOT NULL,
    effort_count integer DEFAULT 0 NOT NULL,
    athlete_count integer DEFAULT 0 NOT NULL,
    segmentid integer DEFAULT 0 NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    map text,
    profile text,
    isstarred smallint DEFAULT 0 NOT NULL,
    total_elevation_loss double precision DEFAULT 0.0 NOT NULL,
    starred_date timestamp without time zone,
    pr_time integer DEFAULT 0 NOT NULL,
    pr_date timestamp without time zone,
    total_effort_count integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL
);


ALTER TABLE public.segmentsstrava OWNER TO postgres;

--
-- Name: segmentsstravaefforts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.segmentsstravaefforts (
    riderid integer NOT NULL,
    segmentid bigint NOT NULL,
    stravaid bigint NOT NULL,
    effortid bigint NOT NULL,
    elapsed_time integer,
    moving_time integer,
    start_date timestamp without time zone,
    distance double precision DEFAULT 0.0 NOT NULL,
    start_index integer,
    end_index integer,
    average_cadence integer,
    average_watts integer,
    average_heartrate integer,
    max_heartrate integer,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.segmentsstravaefforts OWNER TO postgres;

--
-- Name: segmentsstravaeffortupdaterequest; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.segmentsstravaeffortupdaterequest (
    riderid integer NOT NULL,
    stravaid bigint NOT NULL,
    fulfilled boolean DEFAULT false NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.segmentsstravaeffortupdaterequest OWNER TO postgres;

--
-- Name: servicecontrol; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.servicecontrol (
    controlid integer NOT NULL,
    controlname character varying(50) NOT NULL,
    enabled smallint NOT NULL,
    timespanhours double precision NOT NULL,
    laststart timestamp without time zone,
    lastfinish timestamp without time zone,
    nextstart timestamp without time zone
);


ALTER TABLE public.servicecontrol OWNER TO postgres;

--
-- Name: servicecontrol_controlid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.servicecontrol_controlid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.servicecontrol_controlid_seq OWNER TO postgres;

--
-- Name: servicecontrol_controlid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.servicecontrol_controlid_seq OWNED BY public.servicecontrol.controlid;


--
-- Name: servicelog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.servicelog (
    serviceid integer NOT NULL,
    category character varying(25) NOT NULL,
    message character varying(200) NOT NULL,
    insertby character varying(50) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    insertlocal timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.servicelog OWNER TO postgres;

--
-- Name: servicelog_serviceid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.servicelog_serviceid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.servicelog_serviceid_seq OWNER TO postgres;

--
-- Name: servicelog_serviceid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.servicelog_serviceid_seq OWNED BY public.servicelog.serviceid;


--
-- Name: stravaapi; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stravaapi (
    accountid integer NOT NULL,
    clientid integer NOT NULL,
    clientsecret character varying(100),
    permissions character varying(50),
    redirecturl text,
    insertby character varying(50),
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updateby character varying(50),
    updatedttm timestamp without time zone NOT NULL
);


ALTER TABLE public.stravaapi OWNER TO postgres;

--
-- Name: stravaapirider; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stravaapirider (
    accountid integer NOT NULL,
    riderid integer NOT NULL,
    accesstoken character varying(250),
    insertby character varying(50),
    insertdttm timestamp without time zone,
    updateby character varying(50),
    updatedttm timestamp without time zone,
    refreshtoken character varying(250),
    accesstokenexpires bigint,
    accesstokenexpiresutc timestamp without time zone
);


ALTER TABLE public.stravaapirider OWNER TO postgres;

--
-- Name: stravadayratelimits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stravadayratelimits (
    rowid integer NOT NULL,
    dateutc timestamp without time zone NOT NULL,
    fifteenminuteuse integer NOT NULL,
    dailyuse integer NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.stravadayratelimits OWNER TO postgres;

--
-- Name: stravadayratelimits_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stravadayratelimits_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stravadayratelimits_rowid_seq OWNER TO postgres;

--
-- Name: stravadayratelimits_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stravadayratelimits_rowid_seq OWNED BY public.stravadayratelimits.rowid;


--
-- Name: stravarequestlog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stravarequestlog (
    rowid integer NOT NULL,
    riderid integer NOT NULL,
    fifteenminuteuse integer NOT NULL,
    dailyuse integer NOT NULL,
    fifteenminutelimit integer NOT NULL,
    dailylimit integer NOT NULL,
    originalquery character varying(255) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    insertlocal timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.stravarequestlog OWNER TO postgres;

--
-- Name: stravarequestlog_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stravarequestlog_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stravarequestlog_rowid_seq OWNER TO postgres;

--
-- Name: stravarequestlog_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stravarequestlog_rowid_seq OWNED BY public.stravarequestlog.rowid;


--
-- Name: stravaupdatelog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stravaupdatelog (
    rowid integer NOT NULL,
    riderid integer NOT NULL,
    type character varying(25) NOT NULL,
    status character varying(25) NOT NULL,
    result character varying(255) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    insertlocal timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.stravaupdatelog OWNER TO postgres;

--
-- Name: stravaupdatelog_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stravaupdatelog_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stravaupdatelog_rowid_seq OWNER TO postgres;

--
-- Name: stravaupdatelog_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stravaupdatelog_rowid_seq OWNED BY public.stravaupdatelog.rowid;


--
-- Name: system_accounts_jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_accounts_jobs (
    rowid integer NOT NULL,
    systemaccountid integer NOT NULL,
    jobname character varying(50) NOT NULL,
    action character varying(50) NOT NULL,
    frequency integer NOT NULL,
    "time" character varying(8) NOT NULL,
    active smallint DEFAULT 1 NOT NULL,
    insertby character varying(50) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updateby character varying(50) NOT NULL,
    updatedttm timestamp without time zone NOT NULL
);


ALTER TABLE public.system_accounts_jobs OWNER TO postgres;

--
-- Name: system_accounts_jobs_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.system_accounts_jobs_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.system_accounts_jobs_rowid_seq OWNER TO postgres;

--
-- Name: system_accounts_jobs_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.system_accounts_jobs_rowid_seq OWNED BY public.system_accounts_jobs.rowid;


--
-- Name: system_actionlogs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_actionlogs (
    actionlogid integer NOT NULL,
    controller character varying(50) NOT NULL,
    action character varying(100) NOT NULL,
    userid integer NOT NULL,
    ip character varying(20) NOT NULL,
    insertby character varying(50) NOT NULL,
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    arguments character varying(100)
);


ALTER TABLE public.system_actionlogs OWNER TO postgres;

--
-- Name: system_actionlogs_actionlogid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.system_actionlogs_actionlogid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.system_actionlogs_actionlogid_seq OWNER TO postgres;

--
-- Name: system_actionlogs_actionlogid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.system_actionlogs_actionlogid_seq OWNED BY public.system_actionlogs.actionlogid;


--
-- Name: system_users_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_users_roles (
    rowid integer NOT NULL,
    riderid integer NOT NULL,
    role character varying(20) NOT NULL
);


ALTER TABLE public.system_users_roles OWNER TO postgres;

--
-- Name: system_users_roles_rowid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.system_users_roles_rowid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.system_users_roles_rowid_seq OWNER TO postgres;

--
-- Name: system_users_roles_rowid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.system_users_roles_rowid_seq OWNED BY public.system_users_roles.rowid;


--
-- Name: tagassignment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tagassignment (
    assignmentid integer NOT NULL,
    tagid integer NOT NULL,
    locationid integer NOT NULL,
    riderid integer NOT NULL
);


ALTER TABLE public.tagassignment OWNER TO postgres;

--
-- Name: taglocation; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.taglocation (
    locationid integer NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(255),
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.taglocation OWNER TO postgres;

--
-- Name: taglocation_locationid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.taglocation_locationid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.taglocation_locationid_seq OWNER TO postgres;

--
-- Name: taglocation_locationid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.taglocation_locationid_seq OWNED BY public.taglocation.locationid;


--
-- Name: tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tags (
    tagid integer NOT NULL,
    riderid integer NOT NULL,
    name character varying(30) NOT NULL,
    description character varying(255),
    insertdttm timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.tags OWNER TO postgres;

--
-- Name: tags_tagid_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tags_tagid_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tags_tagid_seq OWNER TO postgres;

--
-- Name: tags_tagid_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tags_tagid_seq OWNED BY public.tags.tagid;


--
-- Name: bikes bikeid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bikes ALTER COLUMN bikeid SET DEFAULT nextval('public.bikes_bikeid_seq1'::regclass);


--
-- Name: bikes_components bikecomponentid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bikes_components ALTER COLUMN bikecomponentid SET DEFAULT nextval('public.bikes_components_bikecomponentid_seq'::regclass);


--
-- Name: calendarlookup number; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendarlookup ALTER COLUMN number SET DEFAULT nextval('public.calendarlookup_number_seq'::regclass);


--
-- Name: component_notifications component_notificationid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.component_notifications ALTER COLUMN component_notificationid SET DEFAULT nextval('public.component_notifications_component_notificationid_seq'::regclass);


--
-- Name: components componentid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.components ALTER COLUMN componentid SET DEFAULT nextval('public.components_componentid_seq'::regclass);


--
-- Name: lookupweekstartandend weekid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lookupweekstartandend ALTER COLUMN weekid SET DEFAULT nextval('public.lookupweekstartandend_weekid_seq'::regclass);


--
-- Name: ocdrideconstants ocdconstantid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ocdrideconstants ALTER COLUMN ocdconstantid SET DEFAULT nextval('public.ocdrideconstants_ocdconstantid_seq'::regclass);


--
-- Name: placedistances rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.placedistances ALTER COLUMN rowid SET DEFAULT nextval('public.placedistances_rowid_seq'::regclass);


--
-- Name: places placeid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.places ALTER COLUMN placeid SET DEFAULT nextval('public.places_placeid_seq'::regclass);


--
-- Name: reference_powerlevels rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reference_powerlevels ALTER COLUMN rowid SET DEFAULT nextval('public.reference_powerlevels_rowid_seq'::regclass);


--
-- Name: rideproperties rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rideproperties ALTER COLUMN rowid SET DEFAULT nextval('public.rideproperties_rowid_seq'::regclass);


--
-- Name: rider_goal_summary summary_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rider_goal_summary ALTER COLUMN summary_id SET DEFAULT nextval('public.rider_goal_summary_summary_id_seq'::regclass);


--
-- Name: ridergoals ridergoalid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ridergoals ALTER COLUMN ridergoalid SET DEFAULT nextval('public.ridergoals_ridergoalid_seq'::regclass);


--
-- Name: ridernotifications rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ridernotifications ALTER COLUMN rowid SET DEFAULT nextval('public.ridernotifications_rowid_seq'::regclass);


--
-- Name: riderpropertyvalues propertyid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.riderpropertyvalues ALTER COLUMN propertyid SET DEFAULT nextval('public.riderpropertyvalues_propertyid_seq'::regclass);


--
-- Name: riders riderid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.riders ALTER COLUMN riderid SET DEFAULT nextval('public.riders_riderid_seq1'::regclass);


--
-- Name: rideruns riderunid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rideruns ALTER COLUMN riderunid SET DEFAULT nextval('public.rideruns_riderunid_seq'::regclass);


--
-- Name: riderzones riderzoneid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.riderzones ALTER COLUMN riderzoneid SET DEFAULT nextval('public.riderzones_riderzoneid_seq'::regclass);


--
-- Name: rides rideid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides ALTER COLUMN rideid SET DEFAULT nextval('public.rides_rideid_seq1'::regclass);


--
-- Name: rides_hrdetail ridehrid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_hrdetail ALTER COLUMN ridehrid SET DEFAULT nextval('public.rides_hrdetail_ridehrid_seq'::regclass);


--
-- Name: rides_matches ridematchid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_matches ALTER COLUMN ridematchid SET DEFAULT nextval('public.rides_matches_ridematchid_seq'::regclass);


--
-- Name: rides_powerdetail ridepowerid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_powerdetail ALTER COLUMN ridepowerid SET DEFAULT nextval('public.rides_powerdetail_ridepowerid_seq'::regclass);


--
-- Name: rides_powerprofile_bestefforts powerprofileid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_powerprofile_bestefforts ALTER COLUMN powerprofileid SET DEFAULT nextval('public.rides_powerprofile_bestefforts_powerprofileid_seq'::regclass);


--
-- Name: routepoints routepointid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routepoints ALTER COLUMN routepointid SET DEFAULT nextval('public.routepoints_routepointid_seq'::regclass);


--
-- Name: routes routeid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes ALTER COLUMN routeid SET DEFAULT nextval('public.routes_routeid_seq'::regclass);


--
-- Name: servicecontrol controlid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.servicecontrol ALTER COLUMN controlid SET DEFAULT nextval('public.servicecontrol_controlid_seq'::regclass);


--
-- Name: servicelog serviceid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.servicelog ALTER COLUMN serviceid SET DEFAULT nextval('public.servicelog_serviceid_seq'::regclass);


--
-- Name: stravadayratelimits rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stravadayratelimits ALTER COLUMN rowid SET DEFAULT nextval('public.stravadayratelimits_rowid_seq'::regclass);


--
-- Name: stravarequestlog rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stravarequestlog ALTER COLUMN rowid SET DEFAULT nextval('public.stravarequestlog_rowid_seq'::regclass);


--
-- Name: stravaupdatelog rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stravaupdatelog ALTER COLUMN rowid SET DEFAULT nextval('public.stravaupdatelog_rowid_seq'::regclass);


--
-- Name: system_accounts_jobs rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_accounts_jobs ALTER COLUMN rowid SET DEFAULT nextval('public.system_accounts_jobs_rowid_seq'::regclass);


--
-- Name: system_actionlogs actionlogid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_actionlogs ALTER COLUMN actionlogid SET DEFAULT nextval('public.system_actionlogs_actionlogid_seq'::regclass);


--
-- Name: system_users_roles rowid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_users_roles ALTER COLUMN rowid SET DEFAULT nextval('public.system_users_roles_rowid_seq'::regclass);


--
-- Name: taglocation locationid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.taglocation ALTER COLUMN locationid SET DEFAULT nextval('public.taglocation_locationid_seq'::regclass);


--
-- Name: tags tagid; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags ALTER COLUMN tagid SET DEFAULT nextval('public.tags_tagid_seq'::regclass);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (accountid);


--
-- Name: bikes_components bikes_components_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bikes_components
    ADD CONSTRAINT bikes_components_pkey PRIMARY KEY (bikecomponentid);


--
-- Name: bikes bikes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bikes
    ADD CONSTRAINT bikes_pkey PRIMARY KEY (bikeid);


--
-- Name: calendarlookup calendarlookup_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.calendarlookup
    ADD CONSTRAINT calendarlookup_pkey PRIMARY KEY (number);


--
-- Name: cluster_centroids cluster_centroids_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cluster_centroids
    ADD CONSTRAINT cluster_centroids_pkey PRIMARY KEY (riderid, clusterid, cluster);


--
-- Name: clusters clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clusters
    ADD CONSTRAINT clusters_pkey PRIMARY KEY (clusterid);


--
-- Name: component_notifications component_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.component_notifications
    ADD CONSTRAINT component_notifications_pkey PRIMARY KEY (component_notificationid);


--
-- Name: components components_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.components
    ADD CONSTRAINT components_pkey PRIMARY KEY (componentid);


--
-- Name: cummulatives cummulatives_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cummulatives
    ADD CONSTRAINT cummulatives_pkey PRIMARY KEY (riderid, ride_date);


--
-- Name: lookupweekstartandend lookupweekstartandend_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lookupweekstartandend
    ADD CONSTRAINT lookupweekstartandend_pkey PRIMARY KEY (weekid);


--
-- Name: metrics_by_month_dom metrics_by_month_dom_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.metrics_by_month_dom
    ADD CONSTRAINT metrics_by_month_dom_pkey PRIMARY KEY (riderid, dom);


--
-- Name: metrics_by_year_dow metrics_by_year_dow_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.metrics_by_year_dow
    ADD CONSTRAINT metrics_by_year_dow_pkey PRIMARY KEY (riderid, year);


--
-- Name: metrics_by_year_month metrics_by_year_month_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.metrics_by_year_month
    ADD CONSTRAINT metrics_by_year_month_pkey PRIMARY KEY (riderid, year, month);


--
-- Name: ocdcyclistconstants ocdcyclistconstants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ocdcyclistconstants
    ADD CONSTRAINT ocdcyclistconstants_pkey PRIMARY KEY (constantid);


--
-- Name: ocdrideconstants ocdrideconstants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ocdrideconstants
    ADD CONSTRAINT ocdrideconstants_pkey PRIMARY KEY (ocdconstantid);


--
-- Name: placedistances placedistances_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.placedistances
    ADD CONSTRAINT placedistances_pkey PRIMARY KEY (rowid);


--
-- Name: places places_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.places
    ADD CONSTRAINT places_pkey PRIMARY KEY (placeid);


--
-- Name: power_curve power_curve_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.power_curve
    ADD CONSTRAINT power_curve_pkey PRIMARY KEY (riderid, duration_seconds, period);


--
-- Name: reference_powerlevels reference_powerlevels_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reference_powerlevels
    ADD CONSTRAINT reference_powerlevels_pkey PRIMARY KEY (rowid);


--
-- Name: reference_powerlevels_summary reference_powerlevels_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reference_powerlevels_summary
    ADD CONSTRAINT reference_powerlevels_summary_pkey PRIMARY KEY (level, gender);


--
-- Name: ride_clusters ride_clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ride_clusters
    ADD CONSTRAINT ride_clusters_pkey PRIMARY KEY (riderid, rideid);


--
-- Name: ride_metrics_binary ride_metrics_binary_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ride_metrics_binary
    ADD CONSTRAINT ride_metrics_binary_pkey PRIMARY KEY (rideid);


--
-- Name: rides_streams rideid; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_streams
    ADD CONSTRAINT rideid PRIMARY KEY (rideid);


--
-- Name: rideprofilesegmentefforts rideprofilesegmentefforts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rideprofilesegmentefforts
    ADD CONSTRAINT rideprofilesegmentefforts_pkey PRIMARY KEY (rideid, segmenteffortid);


--
-- Name: rideproperties rideproperties_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rideproperties
    ADD CONSTRAINT rideproperties_pkey PRIMARY KEY (rowid);


--
-- Name: rider_goal_summary rider_goal_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rider_goal_summary
    ADD CONSTRAINT rider_goal_summary_pkey PRIMARY KEY (summary_id);


--
-- Name: rider_match_definition rider_match_definition_new; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rider_match_definition
    ADD CONSTRAINT rider_match_definition_new PRIMARY KEY (riderid, type, period, targetftp);


--
-- Name: tags rider_tag_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT rider_tag_unique UNIQUE (riderid, name);


--
-- Name: ridergoals ridergoals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ridergoals
    ADD CONSTRAINT ridergoals_pkey PRIMARY KEY (ridergoalid);


--
-- Name: ridernotifications ridernotifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ridernotifications
    ADD CONSTRAINT ridernotifications_pkey PRIMARY KEY (rowid);


--
-- Name: riderpropertyvalues riderpropertyvalues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.riderpropertyvalues
    ADD CONSTRAINT riderpropertyvalues_pkey PRIMARY KEY (propertyid);


--
-- Name: riderrideclusterrideassignments riderrideclusterrideassignments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.riderrideclusterrideassignments
    ADD CONSTRAINT riderrideclusterrideassignments_pkey PRIMARY KEY (rideid, riderrideclusterid);


--
-- Name: riders riders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.riders
    ADD CONSTRAINT riders_pkey PRIMARY KEY (riderid);


--
-- Name: rideruns rideruns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rideruns
    ADD CONSTRAINT rideruns_pkey PRIMARY KEY (riderid, riderunid);


--
-- Name: riderweight riderweight_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.riderweight
    ADD CONSTRAINT riderweight_pkey PRIMARY KEY (riderid, date);


--
-- Name: riderzones riderzones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.riderzones
    ADD CONSTRAINT riderzones_pkey PRIMARY KEY (riderzoneid);


--
-- Name: rides_boundingbox rides_boundingbox_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_boundingbox
    ADD CONSTRAINT rides_boundingbox_pkey PRIMARY KEY (rideid);


--
-- Name: rides_hrdetail rides_hrdetail_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_hrdetail
    ADD CONSTRAINT rides_hrdetail_pkey PRIMARY KEY (ridehrid);


--
-- Name: rides_imputeddata rides_imputeddata_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_imputeddata
    ADD CONSTRAINT rides_imputeddata_pkey PRIMARY KEY (rideid, rideidsource);


--
-- Name: rides_matches_new rides_matches_new_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_matches_new
    ADD CONSTRAINT rides_matches_new_pkey PRIMARY KEY (rideid, type, period, startindex);


--
-- Name: rides_matches rides_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_matches
    ADD CONSTRAINT rides_matches_pkey PRIMARY KEY (ridematchid);


--
-- Name: rides_metric_detail rides_metric_detail_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_metric_detail
    ADD CONSTRAINT rides_metric_detail_pkey PRIMARY KEY (rideid, metric, period);


--
-- Name: rides rides_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides
    ADD CONSTRAINT rides_pkey PRIMARY KEY (rideid);

ALTER TABLE public.rides CLUSTER ON rides_pkey;


--
-- Name: rides_powerdetail rides_powerdetail_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_powerdetail
    ADD CONSTRAINT rides_powerdetail_pkey PRIMARY KEY (ridepowerid);


--
-- Name: rides_powerprofile_bestefforts rides_powerprofile_bestefforts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rides_powerprofile_bestefforts
    ADD CONSTRAINT rides_powerprofile_bestefforts_pkey PRIMARY KEY (powerprofileid);


--
-- Name: ridestoprocess ridestoprocess_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ridestoprocess
    ADD CONSTRAINT ridestoprocess_pkey PRIMARY KEY (process, riderid, rideid);


--
-- Name: routepoints routepoints_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routepoints
    ADD CONSTRAINT routepoints_pkey PRIMARY KEY (routepointid);


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (routeid);


--
-- Name: segmentsstrava segmentsstrava_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.segmentsstrava
    ADD CONSTRAINT segmentsstrava_pkey PRIMARY KEY (riderid, id);


--
-- Name: segmentsstravaefforts segmentsstravaefforts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.segmentsstravaefforts
    ADD CONSTRAINT segmentsstravaefforts_pkey PRIMARY KEY (riderid, segmentid, stravaid, effortid);


--
-- Name: segmentsstravaeffortupdaterequest segmentsstravaeffortupdaterequest_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.segmentsstravaeffortupdaterequest
    ADD CONSTRAINT segmentsstravaeffortupdaterequest_pkey PRIMARY KEY (riderid, stravaid, insertdttm);


--
-- Name: servicecontrol servicecontrol_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.servicecontrol
    ADD CONSTRAINT servicecontrol_pkey PRIMARY KEY (controlid);


--
-- Name: servicelog servicelog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.servicelog
    ADD CONSTRAINT servicelog_pkey PRIMARY KEY (serviceid);


--
-- Name: stravaapirider stravaapirider_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stravaapirider
    ADD CONSTRAINT stravaapirider_pkey PRIMARY KEY (accountid, riderid);


--
-- Name: stravadayratelimits stravadayratelimits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stravadayratelimits
    ADD CONSTRAINT stravadayratelimits_pkey PRIMARY KEY (rowid);


--
-- Name: stravarequestlog stravarequestlog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stravarequestlog
    ADD CONSTRAINT stravarequestlog_pkey PRIMARY KEY (rowid);


--
-- Name: stravaupdatelog stravaupdatelog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stravaupdatelog
    ADD CONSTRAINT stravaupdatelog_pkey PRIMARY KEY (rowid);


--
-- Name: system_accounts_jobs system_accounts_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_accounts_jobs
    ADD CONSTRAINT system_accounts_jobs_pkey PRIMARY KEY (rowid);


--
-- Name: system_actionlogs system_actionlogs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_actionlogs
    ADD CONSTRAINT system_actionlogs_pkey PRIMARY KEY (actionlogid);


--
-- Name: system_users_roles system_users_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_users_roles
    ADD CONSTRAINT system_users_roles_pkey PRIMARY KEY (rowid);


--
-- Name: tagassignment tagassignment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tagassignment
    ADD CONSTRAINT tagassignment_pkey PRIMARY KEY (assignmentid, tagid, locationid, riderid);


--
-- Name: taglocation taglocation_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.taglocation
    ADD CONSTRAINT taglocation_name_key UNIQUE (name);


--
-- Name: taglocation taglocation_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.taglocation
    ADD CONSTRAINT taglocation_pkey PRIMARY KEY (locationid);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (tagid);


--
-- Name: clusters unique_rider_years; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.clusters
    ADD CONSTRAINT unique_rider_years UNIQUE (riderid, startyear, endyear);


--
-- Name: idx_riderid_bikeid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_riderid_bikeid ON public.bikes USING btree (riderid, bikeid);


--
-- Name: idx_riderweight_riderid_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_riderweight_riderid_date ON public.riderweight USING btree (riderid, date);


--
-- Name: stravaapirider trigger_update_accesstokenexpiresutc; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_update_accesstokenexpiresutc BEFORE INSERT OR UPDATE ON public.stravaapirider FOR EACH ROW EXECUTE FUNCTION public.update_accesstokenexpiresutc();


--
-- Name: ride_clusters fk_clusterid; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ride_clusters
    ADD CONSTRAINT fk_clusterid FOREIGN KEY (clusterid) REFERENCES public.clusters(clusterid) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: cluster_centroids fk_clusterid; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cluster_centroids
    ADD CONSTRAINT fk_clusterid FOREIGN KEY (clusterid) REFERENCES public.clusters(clusterid) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: power_curve power_curve_riderid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.power_curve
    ADD CONSTRAINT power_curve_riderid_fkey FOREIGN KEY (riderid) REFERENCES public.riders(riderid) ON DELETE CASCADE;


--
-- Name: tagassignment tagassignment_locationid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tagassignment
    ADD CONSTRAINT tagassignment_locationid_fkey FOREIGN KEY (locationid) REFERENCES public.taglocation(locationid) ON DELETE CASCADE;


--
-- Name: tagassignment tagassignment_tagid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tagassignment
    ADD CONSTRAINT tagassignment_tagid_fkey FOREIGN KEY (tagid) REFERENCES public.tags(tagid) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

